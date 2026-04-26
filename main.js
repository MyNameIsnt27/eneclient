const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')
const https = require('https')
const http = require('http')
const { Auth } = require('msmc')
const { Client } = require('minecraft-launcher-core')
const Store = require('electron-store').default
const FormData = require('form-data')

let mainWindow
let authManager = new Auth("select_account")
const launcher = new Client()
const store = new Store()
const mcDir = path.join(os.homedir(), 'AppData', 'Roaming', '.eneclient')
const runtimeDir = path.join(mcDir, 'runtime')

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100, height: 680, minWidth: 900, minHeight: 600,
    frame: false, transparent: true,
    show: false, // Oculta la ventana hasta que el primer frame esté listo
    backgroundColor: '#00000000',
    webPreferences: { nodeIntegration: true, contextIsolation: false }
  })

  // Muestra la ventana en cuanto el primer frame esté pintado → sin flash blanco
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.loadFile('index.html')

  mainWindow.webContents.on('did-finish-load', () => {
    sendProfiles()
    const profiles = getProfiles()
    const activeId = getActiveId()
    const active = profiles.find(p => p.id === activeId) || profiles[0] || null
    if (active) mainWindow.webContents.send('profile', active)
  })
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.on('minimize', () => mainWindow.minimize())
ipcMain.on('close', () => mainWindow.close())
ipcMain.on('open-url', (e, url) => shell.openExternal(url))

function send(msg) { mainWindow.webContents.send('launch-status', msg) }

// ── PERFILES ──────────────────────────────────────────────
function getProfiles() { return store.get('profiles') || [] }
function saveProfiles(p) { store.set('profiles', p) }
function getActiveId() { return store.get('activeProfileId') || null }
function setActiveId(id) { store.set('activeProfileId', id) }

function sendProfiles() {
  mainWindow.webContents.send('profiles-update', {
    profiles: getProfiles(),
    activeId: getActiveId()
  })
}

ipcMain.on('get-profiles', () => sendProfiles())
ipcMain.on('get-profile', () => {
  const profiles = getProfiles()
  const activeId = getActiveId()
  const active = profiles.find(p => p.id === activeId) || profiles[0] || null
  mainWindow.webContents.send('profile', active)
})

ipcMain.on('switch-profile', (e, id) => {
  setActiveId(id)
  sendProfiles()
  const profiles = getProfiles()
  const active = profiles.find(p => p.id === id)
  if (active) mainWindow.webContents.send('profile', active)
})

ipcMain.on('delete-profile', (e, id) => {
  let profiles = getProfiles()
  profiles = profiles.filter(p => p.id !== id)
  saveProfiles(profiles)
  if (getActiveId() === id) {
    setActiveId(profiles[0]?.id || null)
    mainWindow.webContents.send('profile', profiles[0] || null)
  }
  sendProfiles()
})

ipcMain.on('add-guest', (e, username) => {
  if (!username || !username.trim()) return
  const profiles = getProfiles()
  const id = 'guest_' + Date.now()
  const newProfile = {
    id, name: username.trim(),
    uuid: '00000000-0000-0000-0000-' + Date.now(),
    skin: `https://mc-heads.net/avatar/${username.trim()}/100`,
    type: 'guest'
  }
  profiles.push(newProfile)
  saveProfiles(profiles)
  setActiveId(id)
  mainWindow.webContents.send('profile', newProfile)
  sendProfiles()
})

ipcMain.on('add-microsoft', async () => {
  try {
    mainWindow.webContents.send('auth-status', '🔐 Abriendo login de Microsoft...')
    const xboxManager = await authManager.launch("electron")
    const token = await xboxManager.getMinecraft()
    const mclc = token.mclc()
    const profiles = getProfiles()
    const existing = profiles.findIndex(p => p.uuid === mclc.uuid)
    const newProfile = {
      id: 'ms_' + mclc.uuid, name: mclc.name, uuid: mclc.uuid,
      skin: `https://mc-heads.net/avatar/${mclc.uuid}/100`,
      type: 'microsoft', token: mclc
    }
    if (existing >= 0) profiles[existing] = newProfile
    else profiles.push(newProfile)
    saveProfiles(profiles)
    setActiveId(newProfile.id)
    mainWindow.webContents.send('profile', newProfile)
    mainWindow.webContents.send('auth-status', null)
    sendProfiles()
  } catch (err) {
    mainWindow.webContents.send('auth-status', '❌ Error: ' + err.message)
    setTimeout(() => mainWindow.webContents.send('auth-status', null), 3000)
  }
})

ipcMain.on('logout', (e, id) => {
  let profiles = getProfiles()
  const targetId = id || getActiveId()
  profiles = profiles.filter(p => p.id !== targetId)
  saveProfiles(profiles)
  const next = profiles[0] || null
  setActiveId(next?.id || null)
  mainWindow.webContents.send('profile', next)
  sendProfiles()
})

// ── HELPERS HTTP ──────────────────────────────────────────
function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    mod.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return httpsGet(res.headers.location).then(resolve).catch(reject)
      }
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http
    const file = fs.createWriteStream(dest)
    mod.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        return downloadFile(res.headers.location, dest).then(resolve).catch(reject)
      }
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
    }).on('error', err => { try { fs.unlinkSync(dest) } catch {} reject(err) })
  })
}

// ── JAVA ──────────────────────────────────────────────────
async function getRequiredJava(mcVersion) {
  try {
    const data = await httpsGet('https://launchermeta.mojang.com/mc/game/version_manifest.json')
    const manifest = JSON.parse(data)
    const entry = manifest.versions.find(v => v.id === mcVersion)
    if (!entry) return null
    const data2 = await httpsGet(entry.url)
    const vd = JSON.parse(data2)
    return vd.javaVersion || { component: 'jre-legacy', majorVersion: 8 }
  } catch { return null }
}

async function ensureJava(javaVersion) {
  const component = javaVersion?.component || 'jre-legacy'
  const majorVersion = javaVersion?.majorVersion || 8
  const javaDir = path.join(runtimeDir, component, 'bin')
  const javaExe = path.join(javaDir, 'javaw.exe')
  if (fs.existsSync(javaExe)) { send(`☕ Java ${majorVersion} listo`); return javaExe }
  send(`☕ Descargando Java ${majorVersion}...`)
  try {
    const runtimeManifestUrl = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'
    const data = await httpsGet(runtimeManifestUrl)
    const runtimes = JSON.parse(data)
    const wr = runtimes['windows-x64'] || runtimes['windows-x86']
    const cr = wr[component]
    if (!cr || !cr.length) { send('⚠️ Usando Java del sistema'); return 'javaw' }
    const data2 = await httpsGet(cr[0].manifest.url)
    const fm = JSON.parse(data2)
    const fileEntries = Object.entries(fm.files).filter(([, v]) => v.type === 'file')
    const componentDir = path.join(runtimeDir, component)
    fs.mkdirSync(componentDir, { recursive: true })
    let done = 0
    for (const [filePath, fileData] of fileEntries) {
      const fullPath = path.join(componentDir, filePath)
      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      if (!fs.existsSync(fullPath) && fileData.downloads?.raw) {
        await downloadFile(fileData.downloads.raw.url, fullPath)
      }
      done++
      if (done % 20 === 0) send(`☕ Java ${majorVersion}... ${Math.round(done / fileEntries.length * 100)}%`)
    }
    try { fs.chmodSync(javaExe, '755') } catch {}
    send(`✅ Java ${majorVersion} listo`)
    return javaExe
  } catch { return 'javaw' }
}

// ── FABRIC ────────────────────────────────────────────────
async function ensureFabric(mcVersion, javaPath) {
  const data = await httpsGet(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`)
  const loaders = JSON.parse(data)
  if (!loaders.length) throw new Error('No hay loader Fabric para ' + mcVersion)

  const loaderVer = loaders[0].loader.version
  const fabricId  = `fabric-loader-${loaderVer}-${mcVersion}`
  const versionDir = path.join(mcDir, 'versions', fabricId)
  const jsonPath   = path.join(versionDir, `${fabricId}.json`)

  const jarPath = path.join(versionDir, `${fabricId}.jar`)
  const jarEmpty = !fs.existsSync(jarPath) || fs.statSync(jarPath).size === 0
  if (!fs.existsSync(jsonPath) || jarEmpty) {
    send('🔧 Instalando Fabric ' + mcVersion + '...')
    const profileUrl = `https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loaderVer}/profile/json`
    const profileJson = await httpsGet(profileUrl)
    fs.mkdirSync(versionDir, { recursive: true })
    fs.writeFileSync(jsonPath, profileJson)

    const jarPath2 = path.join(versionDir, `${fabricId}.jar`)
    if (!fs.existsSync(jarPath2)) {
      const vanillaJar = path.join(mcDir, 'versions', mcVersion, `${mcVersion}.jar`)
      if (fs.existsSync(vanillaJar)) {
        fs.copyFileSync(vanillaJar, jarPath2)
      } else {
        const manifestData = await httpsGet('https://launchermeta.mojang.com/mc/game/version_manifest.json')
        const manifest = JSON.parse(manifestData)
        const entry = manifest.versions.find(v => v.id === mcVersion)
        if (entry) {
          const versionData = await httpsGet(entry.url)
          const versionJson = JSON.parse(versionData)
          const clientUrl = versionJson.downloads?.client?.url
          if (clientUrl) {
            send('📥 Descargando cliente vanilla para Fabric...')
            fs.mkdirSync(path.join(mcDir, 'versions', mcVersion), { recursive: true })
            await downloadFile(clientUrl, vanillaJar)
            fs.copyFileSync(vanillaJar, jarPath2)
          }
        }
      }
    }
  }

  const modsDir = path.join(mcDir, 'mods')
  fs.mkdirSync(modsDir, { recursive: true })

  send('✅ Fabric listo')
  return fabricId
}

// ── LAUNCH ────────────────────────────────────────────────
ipcMain.on('launch', async (e, opts) => {
  try {
    const profiles = getProfiles()
    const activeId = getActiveId()
    const active = profiles.find(p => p.id === activeId) || profiles[0]
    if (!active) { send('❌ No hay cuenta activa'); setTimeout(() => send(null), 3000); return }

    const rawVersion = opts?.version || '1.8.9'
    const ram = opts?.ram || '4G'

    const rawType  = rawVersion.split('-')[0]
    const mcVersion = rawVersion.replace(/^(fabric|forge|optifine)-/, '')

    send(`👋 Hola ${active.name}! Preparando...`)

    let auth
    if (active.type === 'microsoft' && active.token) {
      auth = {
        access_token: active.token.access_token,
        client_token: active.token.client_token,
        uuid: active.token.uuid,
        name: active.token.name,
        user_properties: '{}'
      }
    } else {
      auth = {
        access_token: 'null',
        client_token: 'null',
        uuid: active.uuid,
        name: active.name,
        user_properties: '{}'
      }
    }

    fs.mkdirSync(mcDir, { recursive: true })

    send(`🔍 Comprobando Java para ${mcVersion}...`)
    const javaVersion = await getRequiredJava(mcVersion)
    const javaPath = await ensureJava(javaVersion)

    let launchVersionId = mcVersion
    let isCustom = false

    if (rawType === 'fabric') {
      launchVersionId = await ensureFabric(mcVersion, javaPath)
      isCustom = true
    } else if (rawType === 'optifine') {
      launchVersionId = mcVersion
    }

    send(`🚀 Lanzando Minecraft ${launchVersionId}...`)

    launcher.removeAllListeners()

    const launchOptions = {
      authorization: auth,
      root: mcDir,
      version: isCustom
        ? { number: mcVersion, type: 'release', custom: launchVersionId }
        : { number: launchVersionId, type: 'release' },
      memory: { max: ram, min: '512M' },
      javaPath
    }

    launcher.launch(launchOptions)

    launcher.on('progress', (ev) => {
      const p = Math.round((ev.task / ev.total) * 100)
      send(`📥 Descargando... ${p}%`)
    })
    launcher.on('data', () => send('⚡ Minecraft corriendo...'))
    launcher.on('close', () => send(null))
    launcher.on('error', (err) => { send('❌ ' + err); setTimeout(() => send(null), 4000) })

  } catch (err) {
    send('❌ ' + err.message)
    setTimeout(() => send(null), 4000)
  }
})

// ── SKIN ──────────────────────────────────────────────────
ipcMain.on('get-skin-url', async () => {
  try {
    const profiles = getProfiles()
    const activeId = getActiveId()
    const active = profiles.find(p => p.id === activeId)
    if (!active || active.type !== 'microsoft') return
    https.get(`https://sessionserver.mojang.com/session/minecraft/profile/${active.uuid}`, res => {
      let data = ''
      res.on('data', d => data += d)
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          const b64 = json.properties.find(p => p.name === 'textures')?.value
          if (!b64) return
          const textures = JSON.parse(Buffer.from(b64, 'base64').toString())
          const skinUrl = textures.textures?.SKIN?.url
          if (skinUrl) mainWindow.webContents.send('skin-url', skinUrl)
        } catch {}
      })
    })
  } catch {}
})

ipcMain.on('upload-skin', async (e, { skinBase64, model }) => {
  try {
    const profiles = getProfiles()
    const activeId = getActiveId()
    const active = profiles.find(p => p.id === activeId)
    if (!active || active.type !== 'microsoft') {
      mainWindow.webContents.send('skin-status', '❌ Necesitas cuenta Microsoft para cambiar la skin')
      return
    }
    const skinPath = path.join(os.tmpdir(), 'eneclient_skin.png')
    const base64Data = skinBase64.replace(/^data:image\/png;base64,/, '')
    fs.writeFileSync(skinPath, Buffer.from(base64Data, 'base64'))
    const form = new FormData()
    form.append('variant', model === 'slim' ? 'slim' : 'classic')
    form.append('file', fs.createReadStream(skinPath), { filename: 'skin.png', contentType: 'image/png' })
    const options = {
      hostname: 'api.minecraftservices.com',
      path: '/minecraft/profile/skins',
      method: 'POST',
      headers: { ...form.getHeaders(), 'Authorization': `Bearer ${active.token.access_token}` }
    }
    const req = https.request(options, (res) => {
      try { fs.unlinkSync(skinPath) } catch {}
      if (res.statusCode === 200 || res.statusCode === 204) {
        mainWindow.webContents.send('skin-status', 'ok')
      } else if (res.statusCode === 401) {
        mainWindow.webContents.send('skin-status', '❌ Sesión expirada — vuelve a iniciar sesión')
      } else {
        mainWindow.webContents.send('skin-status', `❌ Error ${res.statusCode}`)
      }
    })
    req.on('error', (err) => mainWindow.webContents.send('skin-status', '❌ ' + err.message))
    form.pipe(req)
  } catch (err) {
    mainWindow.webContents.send('skin-status', '❌ ' + err.message)
  }
})

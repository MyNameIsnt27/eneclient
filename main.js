const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const os = require('os')
const { Auth } = require('msmc')
const { Client } = require('minecraft-launcher-core')
const Store = require('electron-store').default

let mainWindow
let authManager = new Auth("select_account")
const launcher = new Client()
const store = new Store()

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 680,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  })
  mainWindow.loadFile('index.html')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.on('minimize', () => mainWindow.minimize())
ipcMain.on('close', () => mainWindow.close())
ipcMain.on('open-url', (e, url) => shell.openExternal(url))

function send(msg) { mainWindow.webContents.send('launch-status', msg) }

ipcMain.on('get-profile', () => {
  mainWindow.webContents.send('profile', store.get('profile') || null)
})

ipcMain.on('logout', () => {
  store.delete('profile')
  store.delete('token')
  mainWindow.webContents.send('profile', null)
})

ipcMain.on('launch', async (e, opts) => {
  try {
    let mclc
    const savedToken = store.get('token')

    if (savedToken) {
      send(`👋 Hola ${savedToken.name}! Preparando Minecraft...`)
      mclc = savedToken
    } else {
      send('🔐 Abriendo login de Microsoft...')
      const xboxManager = await authManager.launch("electron")
      const token = await xboxManager.getMinecraft()
      mclc = token.mclc()
      store.set('token', mclc)
      store.set('profile', {
        name: mclc.name,
        uuid: mclc.uuid,
        skin: `https://mc-heads.net/avatar/${mclc.uuid}/100`
      })
      mainWindow.webContents.send('profile', store.get('profile'))
      send(`👋 Hola ${mclc.name}! Preparando Minecraft...`)
    }

    const version = opts?.version || '1.8.9'
    const ram = opts?.ram || '4G'

    launcher.launch({
      authorization: {
        access_token: mclc.access_token,
        client_token: mclc.client_token,
        uuid: mclc.uuid,
        name: mclc.name,
        user_properties: '{}'
      },
      root: path.join(os.homedir(), '.minecraft'),
      version: { number: version, type: 'release' },
      memory: { max: ram, min: '512M' }
    })

    launcher.on('progress', (e) => {
      const percent = Math.round((e.task / e.total) * 100)
      send(`📥 Descargando... ${percent}%`)
    })

    launcher.on('data', (e) => {
      console.log('[MC]', e)
      send('⚡ Minecraft corriendo...')
    })

    launcher.on('close', (code) => {
      console.log('Minecraft cerrado:', code)
      send(null)
    })

    launcher.on('error', (err) => {
      send('❌ Error: ' + err)
      setTimeout(() => send(null), 4000)
    })

  } catch (err) {
    console.error(err)
    send('❌ Error: ' + err.message)
    setTimeout(() => send(null), 4000)
  }
})
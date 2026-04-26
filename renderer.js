const { ipcRenderer } = require('electron')

// ── SPLASH SCREEN ─────────────────────────────────────────
function runSplash(onDone) {
  const splash = document.getElementById('splash')
  const bar = document.getElementById('splashBar')
  const status = document.getElementById('splashStatus')

  const steps = [
    { pct: 20, msg: 'Cargando recursos...' },
    { pct: 45, msg: 'Preparando interfaz...' },
    { pct: 70, msg: 'Comprobando versiones...' },
    { pct: 90, msg: 'Casi listo...' },
    { pct: 100, msg: '¡Listo!' }
  ]

  let i = 0
  function next() {
    if (i >= steps.length) {
      setTimeout(() => {
        splash.classList.add('fade-out')
        setTimeout(() => { splash.style.display = 'none'; onDone() }, 500)
      }, 300)
      return
    }
    const step = steps[i++]
    bar.style.width = step.pct + '%'
    status.textContent = step.msg
    setTimeout(next, i === steps.length ? 400 : 350)
  }
  setTimeout(next, 200)
}

// ── BUFFER IPC ────────────────────────────────────────────
// main.js emite 'profile' y 'profiles-update' nada más arrancar,
// antes de que initApp() registre sus listeners (el splash se lo come).
// Los buffereamos aquí y los procesamos en cuanto initApp() esté listo.
let _bufferedProfile = undefined   // undefined = todavía no llegó nada
let _bufferedProfilesUpdate = null
let _profileListener = null
let _profilesUpdateListener = null

ipcRenderer.on('profile', (e, profile) => {
  if (_profileListener) _profileListener(profile)
  else _bufferedProfile = profile
})

ipcRenderer.on('profiles-update', (e, data) => {
  if (_profilesUpdateListener) _profilesUpdateListener(data)
  else _bufferedProfilesUpdate = data
})

// ── ARRANQUE ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme') || 'purple-green'
  applyTheme(savedTheme)
  runSplash(() => initApp())
})

// ══════════════════════════════════════════════════════════
function initApp() {

  document.getElementById('feedbackLink').addEventListener('click', (e) => {
    e.preventDefault()
    ipcRenderer.send('open-url', 'https://forms.gle/zJJqYv5ZXsbr4s7T9')
  })

  document.getElementById('minimizeBtn').addEventListener('click', () => ipcRenderer.send('minimize'))
  document.getElementById('closeBtn').addEventListener('click', () => ipcRenderer.send('close'))

  // ── NAVEGACIÓN CON TRANSICIÓN ─────────────────────────
  let currentTab = 'home'

  function switchTab(tabId) {
    if (tabId === currentTab) return
    currentTab = tabId
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
    const navItem = document.querySelector(`[data-tab="${tabId}"]`)
    if (navItem) navItem.classList.add('active')
    const tab = document.getElementById('tab-' + tabId)
    if (tab) {
      tab.style.animation = 'none'
      tab.offsetHeight  // fuerza reflow para reiniciar animación CSS
      tab.style.animation = ''
      tab.classList.add('active')
    }
    if (tabId === 'news') loadNews()
  }

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchTab(item.dataset.tab))
  })
  document.getElementById('sidebarProfileBtn').addEventListener('click', () => switchTab('profiles'))

  // ── RELOJ ─────────────────────────────────────────────
  function updateTime() {
    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    document.getElementById('timeDisplay').textContent = `${h}:${m}`
  }
  setInterval(updateTime, 1000)
  updateTime()


  // ── ESTADÍSTICAS DE JUEGO ─────────────────────────────
  function getStats() {
    return {
      lastPlayed:   localStorage.getItem('lastPlayed') || null,
      totalMinutes: parseInt(localStorage.getItem('totalMinutes') || '0'),
      launchCount:  parseInt(localStorage.getItem('launchCount')  || '0')
    }
  }

  function saveStats(patch) {
    if (patch.lastPlayed   !== undefined) localStorage.setItem('lastPlayed',   patch.lastPlayed)
    if (patch.totalMinutes !== undefined) localStorage.setItem('totalMinutes', String(patch.totalMinutes))
    if (patch.launchCount  !== undefined) localStorage.setItem('launchCount',  String(patch.launchCount))
  }

  function formatPlaytime(minutes) {
    if (minutes < 60) return minutes + 'm'
    const h = Math.floor(minutes / 60)
    const m = minutes % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  function formatLastPlayed(isoStr) {
    if (!isoStr) return '—'
    try {
      const d = new Date(isoStr)
      const diff = Math.floor((Date.now() - d) / 1000)
      if (diff < 60)    return 'Ahora mismo'
      if (diff < 3600)  return `Hace ${Math.floor(diff / 60)}m`
      if (diff < 86400) return `Hace ${Math.floor(diff / 3600)}h`
      const days = Math.floor(diff / 86400)
      if (days === 1) return 'Ayer'
      if (days < 7)   return `Hace ${days} días`
      return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
    } catch { return '—' }
  }

  function refreshStats() {
    const s = getStats()
    document.getElementById('lastPlayedDisplay').textContent  = formatLastPlayed(s.lastPlayed)
    document.getElementById('totalTimeDisplay').textContent   = formatPlaytime(s.totalMinutes)
    document.getElementById('launchCountDisplay').textContent = String(s.launchCount)
  }
  refreshStats()

  let sessionStartTime = null

  // ── PERFILES ──────────────────────────────────────────
  let currentProfile = null

  // Registrar listeners y vaciar el buffer acumulado durante el splash
  _profileListener = (profile) => {
    currentProfile = profile
    updateSidebarProfile(profile)
    updateSkinTab(profile)
    updateWelcome(profile)
  }
  _profilesUpdateListener = ({ profiles, activeId }) => {
    renderProfilesList(profiles, activeId)
    const active = profiles.find(p => p.id === activeId) || profiles[0] || null
    updateActiveProfileCard(active)
  }

  // Vaciar buffer (eventos que llegaron antes de initApp)
  if (_bufferedProfile !== undefined) {
    _profileListener(_bufferedProfile)
    _bufferedProfile = undefined
  }
  if (_bufferedProfilesUpdate !== null) {
    _profilesUpdateListener(_bufferedProfilesUpdate)
    _bufferedProfilesUpdate = null
  }

  // Pedir perfil activo explícitamente (cubre el caso de recarga sin buffer)
  ipcRenderer.send('get-profiles')
  ipcRenderer.send('get-profile')

  function updateWelcome(profile) {
    const sub = document.getElementById('welcomeSub')
    if (profile && profile.name) {
      const hour = new Date().getHours()
      const greeting = hour >= 6 && hour < 14 ? 'Buenos días'
                     : hour >= 14 && hour < 21 ? 'Buenas tardes'
                     : 'Buenas noches'
      sub.textContent = `${greeting}, ${profile.name}! Tu launcher listo para jugar.`
    } else {
      sub.textContent = 'Tu launcher de Minecraft ligero y versatil.'
    }
  }

  function updateSidebarProfile(profile) {
    if (profile) {
      document.getElementById('profileName').textContent  = profile.name
      document.getElementById('profileType').textContent  = profile.type === 'microsoft' ? '🪟 Microsoft' : '👤 Guest'
      document.getElementById('profileAvatar').src        = `https://mc-heads.net/avatar/${profile.uuid}/100`
    } else {
      document.getElementById('profileName').textContent  = 'Sin sesión'
      document.getElementById('profileType').textContent  = '—'
      document.getElementById('profileAvatar').src        = 'https://mc-heads.net/avatar/steve/100'
    }
  }

  function updateActiveProfileCard(profile) {
    if (!profile) return
    document.getElementById('activeProfileAvatar').src        = `https://mc-heads.net/avatar/${profile.uuid}/100`
    document.getElementById('activeProfileName').textContent  = profile.name
    document.getElementById('activeProfileTypeBadge').textContent = profile.type === 'microsoft' ? '🪟 Microsoft' : '👤 Guest'
    document.getElementById('activeProfileUUID').textContent  = profile.uuid
  }

  function renderProfilesList(profiles, activeId) {
    const list = document.getElementById('profilesList')
    if (!profiles.length) {
      list.innerHTML = '<div class="news-loading">No hay cuentas añadidas</div>'
      return
    }
    list.innerHTML = ''
    profiles.forEach(p => {
      const item = document.createElement('div')
      item.className = 'profile-item' + (p.id === activeId ? ' active-item' : '')
      item.innerHTML = `
        <div class="profile-item-avatar">
          <img src="https://mc-heads.net/avatar/${p.uuid}/36" onerror="this.src='https://mc-heads.net/avatar/steve/36'" />
        </div>
        <div>
          <div class="profile-item-name">${p.name}</div>
          <div class="profile-item-type">${p.type === 'microsoft' ? '🪟 Microsoft' : '👤 Guest'}</div>
        </div>
        ${p.id === activeId ? '<div class="profile-item-active-badge">Activo</div>' : ''}
        <button class="profile-item-delete" data-id="${p.id}" title="Eliminar">✕</button>
      `
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('profile-item-delete')) return
        ipcRenderer.send('switch-profile', p.id)
      })
      item.querySelector('.profile-item-delete').addEventListener('click', (e) => {
        e.stopPropagation()
        ipcRenderer.send('delete-profile', p.id)
      })
      list.appendChild(item)
    })
  }

  function updateSkinTab(profile) {
    if (!profile) return
    document.getElementById('skinPlayerName').textContent  = profile.name
    document.getElementById('skinCurrentName').textContent = profile.name
    document.getElementById('skinAccountType').textContent = profile.type === 'microsoft' ? '🪟 Microsoft' : '👤 Guest'
    document.getElementById('skinCurrentFace').src         = `https://mc-heads.net/avatar/${profile.uuid}/32`
    document.getElementById('skinHead').src = `https://mc-heads.net/head/${profile.uuid}/100`
  }

  document.getElementById('activeLogoutBtn').addEventListener('click', () => ipcRenderer.send('logout'))
  document.getElementById('addMicrosoftBtn').addEventListener('click', () => ipcRenderer.send('add-microsoft'))

  document.getElementById('addGuestBtn').addEventListener('click', () => {
    const row = document.getElementById('guestInputRow')
    row.style.display = row.style.display === 'none' ? 'flex' : 'none'
    if (row.style.display === 'flex') document.getElementById('guestNameInput').focus()
  })

  document.getElementById('guestConfirmBtn').addEventListener('click', () => {
    const name = document.getElementById('guestNameInput').value.trim()
    if (!name) return
    ipcRenderer.send('add-guest', name)
    document.getElementById('guestNameInput').value = ''
    document.getElementById('guestInputRow').style.display = 'none'
  })

  document.getElementById('guestNameInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('guestConfirmBtn').click()
  })

  ipcRenderer.on('auth-status', (e, msg) => {
    document.getElementById('authStatus').textContent = msg || ''
  })

  // ── AJUSTES ───────────────────────────────────────────
  const savedRam   = localStorage.getItem('ram')   || '4G'
  const savedTheme = localStorage.getItem('theme') || 'purple-green'

  document.getElementById('ramSelect').value   = savedRam
  document.getElementById('themeSelect').value = savedTheme

  document.getElementById('resetStatsBtn').addEventListener('click', () => {
    if (confirm('¿Seguro que quieres reiniciar las estadísticas?')) {
      localStorage.removeItem('lastPlayed')
      localStorage.removeItem('totalMinutes')
      localStorage.removeItem('launchCount')
      refreshStats()
    }
  })

  // ══════════════════════════════════════════════════════
  // BUSCADOR DE VERSIONES
  // ══════════════════════════════════════════════════════

  let allVersions  = []
  let versionsLoaded = false
  let currentFilter  = 'release'

  // ── OptiFine (sin API pública → lista completa hardcoded, todas actualizadas)
  const optifineVersions = [
    { id: 'optifine-1.21.4', type: 'optifine', label: 'OptiFine 1.21.4 HD U J1' },
    { id: 'optifine-1.21.3', type: 'optifine', label: 'OptiFine 1.21.3 HD U J1 pre4' },
    { id: 'optifine-1.21.1', type: 'optifine', label: 'OptiFine 1.21.1 HD U J1' },
    { id: 'optifine-1.21',   type: 'optifine', label: 'OptiFine 1.21 HD U J1' },
    { id: 'optifine-1.20.6', type: 'optifine', label: 'OptiFine 1.20.6 HD U I9' },
    { id: 'optifine-1.20.4', type: 'optifine', label: 'OptiFine 1.20.4 HD U I7' },
    { id: 'optifine-1.20.2', type: 'optifine', label: 'OptiFine 1.20.2 HD U I6' },
    { id: 'optifine-1.20.1', type: 'optifine', label: 'OptiFine 1.20.1 HD U I6' },
    { id: 'optifine-1.20',   type: 'optifine', label: 'OptiFine 1.20 HD U I4' },
    { id: 'optifine-1.19.4', type: 'optifine', label: 'OptiFine 1.19.4 HD U I4' },
    { id: 'optifine-1.19.3', type: 'optifine', label: 'OptiFine 1.19.3 HD U I3' },
    { id: 'optifine-1.19.2', type: 'optifine', label: 'OptiFine 1.19.2 HD U I2' },
    { id: 'optifine-1.19',   type: 'optifine', label: 'OptiFine 1.19 HD U H9' },
    { id: 'optifine-1.18.2', type: 'optifine', label: 'OptiFine 1.18.2 HD U H7' },
    { id: 'optifine-1.18.1', type: 'optifine', label: 'OptiFine 1.18.1 HD U H5' },
    { id: 'optifine-1.17.1', type: 'optifine', label: 'OptiFine 1.17.1 HD U H1' },
    { id: 'optifine-1.16.5', type: 'optifine', label: 'OptiFine 1.16.5 HD U G8' },
    { id: 'optifine-1.16.4', type: 'optifine', label: 'OptiFine 1.16.4 HD U G5' },
    { id: 'optifine-1.16.3', type: 'optifine', label: 'OptiFine 1.16.3 HD U G3' },
    { id: 'optifine-1.16.2', type: 'optifine', label: 'OptiFine 1.16.2 HD U G3' },
    { id: 'optifine-1.16.1', type: 'optifine', label: 'OptiFine 1.16.1 HD U G1' },
    { id: 'optifine-1.15.2', type: 'optifine', label: 'OptiFine 1.15.2 HD U G1' },
    { id: 'optifine-1.14.4', type: 'optifine', label: 'OptiFine 1.14.4 HD U F5' },
    { id: 'optifine-1.13.2', type: 'optifine', label: 'OptiFine 1.13.2 HD U E7' },
    { id: 'optifine-1.12.2', type: 'optifine', label: 'OptiFine 1.12.2 HD U F5' },
    { id: 'optifine-1.12.1', type: 'optifine', label: 'OptiFine 1.12.1 HD U E4' },
    { id: 'optifine-1.12',   type: 'optifine', label: 'OptiFine 1.12 HD U E3' },
    { id: 'optifine-1.11.2', type: 'optifine', label: 'OptiFine 1.11.2 HD U C6' },
    { id: 'optifine-1.10.2', type: 'optifine', label: 'OptiFine 1.10.2 HD U D3' },
    { id: 'optifine-1.9.4',  type: 'optifine', label: 'OptiFine 1.9.4 HD U C7' },
    { id: 'optifine-1.8.9',  type: 'optifine', label: 'OptiFine 1.8.9 HD U L5' },
    { id: 'optifine-1.8',    type: 'optifine', label: 'OptiFine 1.8 HD U H8' },
    { id: 'optifine-1.7.10', type: 'optifine', label: 'OptiFine 1.7.10 HD U E7' },
  ]

  // ── Fabric fallback (si la API falla)
  const fabricFallback = [
    '1.21.4','1.21.3','1.21.1','1.21','1.20.6','1.20.4','1.20.2','1.20.1',
    '1.20','1.19.4','1.19.3','1.19.2','1.19','1.18.2','1.18.1','1.17.1',
    '1.16.5','1.16.4','1.15.2','1.14.4','1.13.2','1.12.2'
  ].map(v => ({ id: `fabric-${v}`, type: 'fabric', label: `Fabric ${v}` }))


  // ── Cargar Fabric desde su API oficial (auto-actualizable)
  async function loadFabricVersions() {
    try {
      const res = await fetch('https://meta.fabricmc.net/v2/versions/game')
      const data = await res.json()
      // Solo versiones estables de MC
      return data
        .filter(v => v.stable === true)
        .map(v => ({ id: `fabric-${v.version}`, type: 'fabric', label: `Fabric ${v.version}` }))
    } catch {
      return fabricFallback
    }
  }


  // ── Cargar todo en paralelo
  async function ensureVersionsLoaded() {
    if (versionsLoaded) return
    versionsLoaded = true

    const [mojangData, fabricVersions] = await Promise.all([
    fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json')
      .then(r => r.json()).catch(() => null),
    loadFabricVersions()
  ])

    let releases  = []
    let snapshots = []

    if (mojangData) {
      releases  = mojangData.versions.filter(v => v.type === 'release')
                    .map(v => ({ id: v.id, type: 'release',   label: v.id }))
      snapshots = mojangData.versions.filter(v => v.type === 'snapshot')
                    .map(v => ({ id: v.id, type: 'snapshot', label: v.id }))
    } else {
      releases = ['1.21.4','1.20.4','1.19.4','1.18.2','1.16.5','1.12.2','1.8.9']
                  .map(v => ({ id: v, type: 'release', label: v }))
    }

    allVersions = [...releases, ...snapshots, ...optifineVersions, ...fabricVersions]
    renderVersionList()
  }

  function getFilteredVersions(filter, query) {
    let list = allVersions
    if      (filter === 'release')  list = list.filter(v => v.type === 'release')
    else if (filter === 'snapshot') list = list.filter(v => v.type === 'snapshot')
    else if (filter === 'optifine') list = list.filter(v => v.type === 'optifine')
    else if (filter === 'fabric')   list = list.filter(v => v.type === 'fabric')
    else if (filter === 'forge')    list = list.filter(v => v.type === 'forge')
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(v => v.label.toLowerCase().includes(q) || v.id.toLowerCase().includes(q))
    }
    return list
  }

  function renderVersionList() {
    const scroll   = document.getElementById('versionListScroll')
    const query    = document.getElementById('versionSearchInput').value.trim()
    const current  = localStorage.getItem('version') || '1.8.9'
    const list     = getFilteredVersions(currentFilter, query)

    if (!list.length) {
      scroll.innerHTML = '<div class="news-loading" style="padding:20px 10px">No se encontraron versiones</div>'
      return
    }
    scroll.innerHTML = ''
    list.forEach(v => {
      const item = document.createElement('div')
      item.className = 'version-item' + (v.id === current ? ' selected' : '')
      item.innerHTML = `
        <div class="version-item-dot version-dot-${v.type}"></div>
        <div class="version-item-name">${v.label}</div>
        <span class="version-item-badge badge-${v.type}">${v.type}</span>
        <span class="version-item-check">✓</span>
      `
      item.addEventListener('click', () => {
        selectVersion(v.id, v.label)
        closeVersionModal()
      })
      scroll.appendChild(item)
    })
  }

  function selectVersion(id, label) {
    localStorage.setItem('version', id)
    document.getElementById('versionDisplay').textContent      = id
    document.getElementById('quickVersionText').textContent    = label || id
    document.getElementById('settingVersionLabel').textContent = label || id
    updateStatCards(id, localStorage.getItem('ram') || '4G')
  }

  function openVersionModal() {
    document.getElementById('versionModal').style.display = 'flex'
    document.getElementById('versionSearchInput').value = ''
    if (!versionsLoaded) {
      document.getElementById('versionListScroll').innerHTML =
        '<div class="news-loading" style="padding:20px 10px">Cargando versiones...</div>'
    }
    ensureVersionsLoaded().then(() => renderVersionList())
    setTimeout(() => document.getElementById('versionSearchInput').focus(), 100)
  }

  function closeVersionModal() {
    document.getElementById('versionModal').style.display = 'none'
  }

  document.getElementById('quickVersionBtn').addEventListener('click', openVersionModal)
  document.getElementById('settingVersionBtn').addEventListener('click', openVersionModal)
  document.getElementById('versionModalClose').addEventListener('click', closeVersionModal)
  document.getElementById('versionModal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('versionModal')) closeVersionModal()
  })
  document.getElementById('versionSearchInput').addEventListener('input', renderVersionList)

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      currentFilter = btn.dataset.filter
      renderVersionList()
    })
  })

  // Inicializar etiquetas de versión con el valor guardado
  const initVersion = localStorage.getItem('version') || '1.8.9'
  document.getElementById('quickVersionText').textContent    = initVersion
  document.getElementById('settingVersionLabel').textContent = initVersion
  document.getElementById('versionDisplay').textContent      = initVersion

  document.getElementById('ramSelect').addEventListener('change', (e) => {
    localStorage.setItem('ram', e.target.value)
    updateStatCards(localStorage.getItem('version') || '1.8.9', e.target.value)
  })
  document.getElementById('themeSelect').addEventListener('change', (e) => {
    localStorage.setItem('theme', e.target.value)
    applyTheme(e.target.value)
  })

  function updateStatCards(version, ram) {
    document.getElementById('versionDisplay').textContent = version
    document.getElementById('ramDisplay').textContent     = ram.replace('G', ' GB')
  }
  updateStatCards(initVersion, savedRam)

  // ── LANZAR ────────────────────────────────────────────
  document.getElementById('launchBtn').addEventListener('click', () => {
    const version = localStorage.getItem('version') || '1.8.9'
    const ram     = localStorage.getItem('ram')     || '4G'
    sessionStartTime = Date.now()
    const s = getStats()
    saveStats({ launchCount: s.launchCount + 1 })
    refreshStats()
    ipcRenderer.send('launch', { version, ram })
  })

  ipcRenderer.on('launch-status', (e, status) => {
    const btn = document.getElementById('launchBtn')
    if (!status) {
      if (sessionStartTime) {
        const elapsed = Math.floor((Date.now() - sessionStartTime) / 60000)
        const s = getStats()
        saveStats({
          lastPlayed:   new Date().toISOString(),
          totalMinutes: s.totalMinutes + Math.max(elapsed, 1)
        })
        sessionStartTime = null
        refreshStats()
      }
      btn.innerHTML = '<span class="launch-icon">▶</span> Lanzar Minecraft'
      btn.disabled = false
      return
    }
    btn.textContent = status
    btn.disabled = true
  })

  // ── NOTICIAS ──────────────────────────────────────────
  function formatDate(str) {
    if (!str) return ''
    try {
      return new Date(str.split('T')[0] + 'T12:00:00').toLocaleDateString('es-ES', {
        day: 'numeric', month: 'short', year: 'numeric'
      })
    } catch { return str }
  }

  let newsLoaded = false
  let newsData   = []

  async function fetchNews() {
    if (newsData.length) return newsData
    try {
      const res  = await fetch('https://launchercontent.mojang.com/v2/javaPatchNotes.json')
      const data = await res.json()
      newsData = data.entries || []
    } catch { newsData = [] }
    return newsData
  }

  async function loadNews() {
    if (newsLoaded) return
    newsLoaded = true
    const grid = document.getElementById('newsGrid')
    grid.innerHTML = '<div class="news-loading">Cargando noticias...</div>'
    const entries = await fetchNews()
    if (!entries.length) { grid.innerHTML = '<div class="news-loading">No se pudieron cargar.</div>'; return }
    grid.innerHTML = ''
    entries.slice(0, 12).forEach(entry => {
      const imgUrl = entry.image?.url ? `https://launchercontent.mojang.com${entry.image.url}` : null
      const card = document.createElement('div')
      card.className = 'news-card'
      card.innerHTML = `
        ${imgUrl ? `<img src="${imgUrl}" onerror="this.style.display='none'" />` : ''}
        <div class="news-card-body">
          <div class="news-card-title">${entry.title}</div>
          <div class="news-card-date">${formatDate(entry.date)}</div>
        </div>
      `
      card.addEventListener('click', () => ipcRenderer.send('open-url', 'https://www.minecraft.net/en-us/updates'))
      grid.appendChild(card)
    })
  }

  async function loadNewsMini() {
    const mini    = document.getElementById('newsMini')
    const entries = await fetchNews()
    if (!entries.length) { mini.innerHTML = '<div class="news-loading">No se pudieron cargar.</div>'; return }
    mini.innerHTML = ''
    entries.slice(0, 3).forEach(entry => {
      const imgUrl = entry.image?.url ? `https://launchercontent.mojang.com${entry.image.url}` : null
      const card = document.createElement('div')
      card.className = 'news-mini-card'
      card.innerHTML = `
        ${imgUrl ? `<img class="news-mini-img" src="${imgUrl}" onerror="this.style.display='none'" />` : '<div class="news-mini-img-placeholder"></div>'}
        <div class="news-mini-info">
          <div class="news-mini-title">${entry.title}</div>
          <div class="news-mini-date">${formatDate(entry.date)}</div>
        </div>
      `
      card.addEventListener('click', () => ipcRenderer.send('open-url', 'https://www.minecraft.net/en-us/updates'))
      mini.appendChild(card)
    })
  }
  loadNewsMini()

  // ── SKIN ──────────────────────────────────────────────
  let selectedSkinBase64 = null
  let selectedModel      = 'classic'

  document.getElementById('skinUploadArea').addEventListener('click', () => {
    document.getElementById('skinFileInput').click()
  })

  const uploadArea = document.getElementById('skinUploadArea')
  uploadArea.addEventListener('dragover',  e => { e.preventDefault(); uploadArea.style.borderColor = 'var(--c1)' })
  uploadArea.addEventListener('dragleave', () => { uploadArea.style.borderColor = '' })
  uploadArea.addEventListener('drop', e => {
    e.preventDefault()
    uploadArea.style.borderColor = ''
    const file = e.dataTransfer.files[0]
    if (file && file.name.endsWith('.png')) handleSkinFile(file)
  })

  document.getElementById('skinFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0]
    if (file) handleSkinFile(file)
  })

  function handleSkinFile(file) {
    const reader = new FileReader()
    reader.onload = (e) => {
      selectedSkinBase64 = e.target.result
      skinViewer.loadSkin(e.target.result)
    }
    reader.readAsDataURL(file)
    document.getElementById('skinUploadText').innerHTML =
      `✅ <b>${file.name}</b> listo<br><span>Dale a "Subir skin" para aplicarlo</span>`
    document.getElementById('skinUploadBtn').disabled = false
    document.getElementById('skinStatus').textContent = ''
  }

  document.getElementById('modelClassic').addEventListener('click', () => {
    selectedModel = 'classic'
    document.getElementById('modelClassic').classList.add('active')
    document.getElementById('modelSlim').classList.remove('active')
  })
  document.getElementById('modelSlim').addEventListener('click', () => {
    selectedModel = 'slim'
    document.getElementById('modelSlim').classList.add('active')
    document.getElementById('modelClassic').classList.remove('active')
  })

  document.getElementById('skinUploadBtn').addEventListener('click', () => {
    if (!selectedSkinBase64) return
    document.getElementById('skinStatus').textContent  = '⏳ Subiendo skin...'
    document.getElementById('skinUploadBtn').disabled  = true
    ipcRenderer.send('upload-skin', { skinBase64: selectedSkinBase64, model: selectedModel })
  })

  ipcRenderer.on('skin-status', (e, msg) => {
    document.getElementById('skinUploadBtn').disabled = false
    if (msg === 'ok') {
      document.getElementById('skinStatus').textContent = '✅ Skin subida — actualizando...'
      document.getElementById('skinUploadText').innerHTML =
        'Arrastra tu skin aquí<br><span>o haz clic para seleccionar</span>'
      selectedSkinBase64 = null
      setTimeout(() => {
        ipcRenderer.send('get-skin-url')
        document.getElementById('skinStatus').textContent = '✅ Skin actualizada'
      }, 5000)
    } else {
      document.getElementById('skinStatus').textContent = msg
    }
  })

  ipcRenderer.on('skin-url', (e, url) => {
    if (currentProfile) document.getElementById('skinViewer3d').src = `https://mc-heads.net/body/${currentProfile.uuid}/100?t=${Date.now()}`
    if (currentProfile) {
  document.getElementById('skinHead').src = `https://mc-heads.net/head/${currentProfile.uuid}/100?t=${Date.now()}`
}
  })

  document.getElementById('skinRefreshBtn').addEventListener('click', () => {
    ipcRenderer.send('get-skin-url')
    document.getElementById('skinStatus').textContent = '🔄 Actualizando...'
    setTimeout(() => document.getElementById('skinStatus').textContent = '', 1500)
  })

} // fin initApp

// ── TEMA (fuera de initApp, se llama antes del splash) ────
function applyTheme(theme) {
  document.body.className = theme === 'purple-green' ? '' : `theme-${theme}`
}

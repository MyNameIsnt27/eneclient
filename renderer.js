const { ipcRenderer } = require('electron')

document.addEventListener('DOMContentLoaded', () => {

  // Controles ventana
  document.getElementById('minimizeBtn').addEventListener('click', () => ipcRenderer.send('minimize'))
  document.getElementById('closeBtn').addEventListener('click', () => ipcRenderer.send('close'))

  // Navegación
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'))
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'))
      item.classList.add('active')
      document.getElementById('tab-' + item.dataset.tab).classList.add('active')
      if (item.dataset.tab === 'news') loadNews()
    })
  })

  // Reloj
  function updateTime() {
    const now = new Date()
    const h = String(now.getHours()).padStart(2, '0')
    const m = String(now.getMinutes()).padStart(2, '0')
    document.getElementById('timeDisplay').textContent = `${h}:${m}`
  }
  setInterval(updateTime, 1000)
  updateTime()

  // Perfil
  ipcRenderer.send('get-profile')
  ipcRenderer.on('profile', (e, profile) => {
    if (profile) {
      document.getElementById('profileName').textContent = profile.name
      document.getElementById('profileAvatar').src = profile.skin
    } else {
      document.getElementById('profileName').textContent = 'Sin sesión'
      document.getElementById('profileAvatar').src = 'https://mc-heads.net/avatar/steve/100'
    }
  })

  document.getElementById('logoutBtn').addEventListener('click', () => ipcRenderer.send('logout'))

  // Ajustes — cargar guardados
  const savedVersion = localStorage.getItem('version') || '1.8.9'
  const savedRam = localStorage.getItem('ram') || '4G'
  const savedTheme = localStorage.getItem('theme') || 'purple-green'

  document.getElementById('versionSelect').value = savedVersion
  document.getElementById('ramSelect').value = savedRam
  document.getElementById('themeSelect').value = savedTheme
  applyTheme(savedTheme)
  updateStatCards(savedVersion, savedRam)

  document.getElementById('versionSelect').addEventListener('change', (e) => {
    localStorage.setItem('version', e.target.value)
    updateStatCards(e.target.value, localStorage.getItem('ram') || '4G')
  })

  document.getElementById('ramSelect').addEventListener('change', (e) => {
    localStorage.setItem('ram', e.target.value)
    updateStatCards(localStorage.getItem('version') || '1.8.9', e.target.value)
  })

  document.getElementById('themeSelect').addEventListener('change', (e) => {
    localStorage.setItem('theme', e.target.value)
    applyTheme(e.target.value)
  })

  function applyTheme(theme) {
    document.body.className = theme === 'purple-green' ? '' : `theme-${theme}`
  }

  function updateStatCards(version, ram) {
    document.getElementById('versionDisplay').textContent = version
    document.getElementById('ramDisplay').textContent = ram.replace('G', ' GB')
  }

  // Lanzar
  document.getElementById('launchBtn').addEventListener('click', () => {
    const version = localStorage.getItem('version') || '1.8.9'
    const ram = localStorage.getItem('ram') || '4G'
    ipcRenderer.send('launch', { version, ram })
  })

  ipcRenderer.on('launch-status', (e, status) => {
    const btn = document.getElementById('launchBtn')
    if (!status) {
      btn.innerHTML = '<span class="launch-icon">▶</span> Lanzar Minecraft'
      btn.disabled = false
      return
    }
    btn.textContent = status
    btn.disabled = true
  })

  // Noticias
  let newsLoaded = false

  async function loadNews() {
    if (newsLoaded) return
    newsLoaded = true
    const grid = document.getElementById('newsGrid')
    grid.innerHTML = '<div class="news-loading">Cargando noticias...</div>'
    try {
      const res = await fetch('https://launchercontent.mojang.com/javaPatchNotes.json')
      const data = await res.json()
      const entries = data.entries.slice(0, 9)
      grid.innerHTML = ''
      entries.forEach(entry => {
        const card = document.createElement('div')
        card.className = 'news-card'
        const img = entry.image?.url ? `<img src="https://launchercontent.mojang.com${entry.image.url}" onerror="this.style.display='none'" />` : ''
        card.innerHTML = `
          ${img}
          <div class="news-card-body">
            <div class="news-card-title">${entry.title}</div>
            <div class="news-card-date">${new Date(entry.date).toLocaleDateString('es-ES')}</div>
          </div>
        `
        card.addEventListener('click', () => {
          ipcRenderer.send('open-url', `https://minecraft.net/article/${entry.id}`)
        })
        grid.appendChild(card)
      })
    } catch (e) {
      grid.innerHTML = '<div class="news-loading">No se pudieron cargar las noticias.</div>'
    }
  }

  // Noticias mini en inicio
  async function loadNewsMini() {
    const mini = document.getElementById('newsMini')
    try {
      const res = await fetch('https://launchercontent.mojang.com/javaPatchNotes.json')
      const data = await res.json()
      const entries = data.entries.slice(0, 3)
      mini.innerHTML = ''
      entries.forEach(entry => {
        const card = document.createElement('div')
        card.className = 'news-mini-card'
        card.innerHTML = `
          <div class="news-mini-dot"></div>
          <div class="news-mini-title">${entry.title}</div>
          <div class="news-mini-date">${new Date(entry.date).toLocaleDateString('es-ES')}</div>
        `
        card.addEventListener('click', () => {
          ipcRenderer.send('open-url', `https://minecraft.net/article/${entry.id}`)
        })
        mini.appendChild(card)
      })
    } catch (e) {
      mini.innerHTML = '<div class="news-loading">No se pudieron cargar las noticias.</div>'
    }
  }

  loadNewsMini()

})
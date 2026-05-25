const LANGUAGES = [
  { code: 'auto', name: '自动检测' },
  { code: 'zh-CN', name: '中文（简体）' },
  { code: 'en', name: 'English - 英语' },
  { code: 'ja', name: '日本語 - 日语' },
  { code: 'ko', name: '한국어 - 韩语' },
  { code: 'es', name: 'Español - 西班牙语' },
  { code: 'fr', name: 'Français - 法语' },
  { code: 'de', name: 'Deutsch - 德语' },
  { code: 'ru', name: 'Русский - 俄语' },
  { code: 'pt', name: 'Português - 葡萄牙语' },
  { code: 'ar', name: 'العربية - 阿拉伯语' },
  { code: 'it', name: 'Italiano - 意大利语' },
  { code: 'th', name: 'ไทย - 泰语' },
  { code: 'vi', name: 'Tiếng Việt - 越南语' },
  { code: 'hi', name: 'हिन्दी - 印地语' },
];

const DEFAULT_FROM = 'en';
const DEFAULT_TO = 'zh-CN';

const fromSelect = document.getElementById('fromLang');
const toSelect = document.getElementById('toLang');
const swapBtn = document.getElementById('swapBtn');
const translateBtn = document.getElementById('translateBtn');
const restoreBtn = document.getElementById('restoreBtn');
const statusEl = document.getElementById('status');
const noTabEl = document.getElementById('noTab');
const mainContent = document.getElementById('mainContent');

// Populate language options
function populateLanguages() {
  for (const lang of LANGUAGES) {
    const opt1 = document.createElement('option');
    opt1.value = lang.code;
    opt1.textContent = lang.name;
    fromSelect.appendChild(opt1);

    if (lang.code === 'auto') continue; // skip auto-detect for target

    const opt2 = document.createElement('option');
    opt2.value = lang.code;
    opt2.textContent = lang.name;
    toSelect.appendChild(opt2);
  }
}

// Swap languages
swapBtn.addEventListener('click', () => {
  const from = fromSelect.value;
  const to = toSelect.value;
  if (from === 'auto') {
    showStatus('自动检测不能作为目标语言', 'error');
    return;
  }
  fromSelect.value = to;
  toSelect.value = from;
  savePreference();
});

// Save/load language preferences
function savePreference() {
  chrome.storage.local.set({
    fromLang: fromSelect.value,
    toLang: toSelect.value,
  });
}

function loadPreference() {
  chrome.storage.local.get(['fromLang', 'toLang'], (result) => {
    if (result.fromLang) fromSelect.value = result.fromLang;
    if (result.toLang) toSelect.value = result.toLang;
  });
}

// Check if active tab is valid
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function isValidTab(tab) {
  if (!tab) return false;
  const url = tab.url || '';
  if (!url || url === 'about:blank') return false;
  if (url.startsWith('chrome://') || url.startsWith('edge://') || url.startsWith('about:') || url.startsWith('chrome-extension://')) return false;
  return true;
}

async function checkTab() {
  const tab = await getActiveTab();
  if (!isValidTab(tab)) {
    noTabEl.classList.add('visible');
    mainContent.style.display = 'none';
    return null;
  }
  noTabEl.classList.remove('visible');
  mainContent.style.display = 'block';
  return tab;
}

// Status display
function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className = 'status visible ' + (type || 'info');
}

function hideStatus() {
  statusEl.className = 'status';
  statusEl.textContent = '';
}

// Send translation message to content script
async function sendToContentScript(tabId, action, data) {
  // First try: send message directly
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action, ...data });
    return response;
  } catch (e) {
    if (e.message.includes('Could not establish connection') || e.message.includes('Receiving end does not exist')) {
      // Content script not available — inject it dynamically
      showStatus('正在注入翻译脚本...', 'info');
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['content.js'],
        });
        // Wait for script to initialize
        await new Promise((resolve) => setTimeout(resolve, 300));
        const response = await chrome.tabs.sendMessage(tabId, { action, ...data });
        return response;
      } catch (injectError) {
        // Check if this is a restricted page
        showStatus('无法在此页面执行翻译脚本（该页面类型不受支持）', 'error');
        return null;
      }
    } else {
      showStatus('发送消息失败: ' + e.message, 'error');
      return null;
    }
  }
}

// Handle translate button click
translateBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!isValidTab(tab)) {
    showStatus('没有可翻译的页面', 'error');
    return;
  }

  const from = fromSelect.value;
  const to = toSelect.value;

  if (from === to) {
    showStatus('源语言和目标语言不能相同', 'error');
    return;
  }

  translateBtn.disabled = true;
  translateBtn.classList.add('translating');
  translateBtn.textContent = '翻译中...';
  restoreBtn.style.display = 'none';
  showStatus('正在提取页面文本...', 'info');

  const response = await sendToContentScript(tab.id, 'translatePage', { from, to });

  if (response === null) {
    resetButton();
    return;
  }

  if (response && response.success) {
    showStatus('✅ 翻译完成！已处理 ' + (response.count || 0) + ' 段文本。', 'success');
    restoreBtn.style.display = 'block';
  } else if (response && response.error) {
    showStatus('翻译失败: ' + response.error, 'error');
  } else {
    showStatus('翻译完成', 'success');
    restoreBtn.style.display = 'block';
  }

  resetButton();
});

// Handle restore button click
restoreBtn.addEventListener('click', async () => {
  const tab = await getActiveTab();
  if (!isValidTab(tab)) return;
  restoreBtn.style.display = 'none';
  const response = await sendToContentScript(tab.id, 'restorePage', {});
  if (response && response.success) {
    showStatus('已恢复原文', 'info');
  } else {
    showStatus('恢复失败: ' + (response && response.error ? response.error : '未知错误'), 'error');
  }
});

function resetButton() {
  translateBtn.disabled = false;
  translateBtn.classList.remove('translating');
  translateBtn.textContent = '翻译页面';
}

// Listen for progress updates from content script
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'translateProgress') {
    showStatus(message.text, 'progress');
  }
});

// Initialize
async function init() {
  populateLanguages();
  fromSelect.value = DEFAULT_FROM;
  toSelect.value = DEFAULT_TO;
  loadPreference();
  await checkTab();

  // Save preferences on change
  fromSelect.addEventListener('change', savePreference);
  toSelect.addEventListener('change', savePreference);
}

init();

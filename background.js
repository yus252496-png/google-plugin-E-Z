// MyMemory 翻译 API（国内可访问，无需 API Key）
const LANG_MAP = {
  'auto': 'en',   // 自动检测默认使用英语
  'zh-CN': 'zh-CN',
  'en': 'en',
  'ja': 'ja',
  'ko': 'ko',
  'es': 'es',
  'fr': 'fr',
  'de': 'de',
  'ru': 'ru',
  'pt': 'pt',
  'ar': 'ar',
  'it': 'it',
  'th': 'th',
  'vi': 'vi',
  'hi': 'hi',
};

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translateBatch') {
    translateBatch(request.texts, request.from, request.to)
      .then((translations) => sendResponse({ translations }))
      .catch((error) => {
        console.error('Translation error:', error);
        sendResponse({ error: error.message });
      });
    return true;
  }
});

async function translateBatch(texts, from, to) {
  const results = [];
  // 分组顺序执行，每组 4 个并行（避免触发频率限制）
  for (let i = 0; i < texts.length; i += 4) {
    const batch = texts.slice(i, i + 4);
    const batchResults = await Promise.all(
      batch.map((text) => translateOne(text, from, to))
    );
    results.push(...batchResults);
    // 每组之间间隔 200ms，降低触发频率限制概率
    if (i + 4 < texts.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return results;
}

async function translateOne(text, from, to) {
  const safeText = text.length > 1000 ? text.substring(0, 1000) : text;
  const fromCode = LANG_MAP[from] || 'en';
  const toCode = LANG_MAP[to] || 'zh-CN';

  try {
    const response = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(safeText)}&langpair=${fromCode}|${toCode}&mt=1`,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        console.warn('[翻译助手] MyMemory 频率限制，等待后重试');
        await new Promise((r) => setTimeout(r, 1000));
        return ''; // 返回空，下次重试时会重新请求
      }
      console.warn('[翻译助手] MyMemory 请求失败:', response.status);
      return '';
    }

    const data = await response.json();
    if (data && data.responseData && data.responseData.translatedText) {
      const result = data.responseData.translatedText;
      if (data.quotaFinished) {
        console.warn('[翻译助手] MyMemory 每日配额已用完');
      }
      return result;
    }
    return '';
  } catch (e) {
    console.warn('[翻译助手] MyMemory 请求异常:', e.message);
    return '';
  }
}

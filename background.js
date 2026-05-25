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
  // Process texts individually, parallelizing 8 at a time to avoid rate limits
  for (let i = 0; i < texts.length; i += 8) {
    const batch = texts.slice(i, i + 8);
    const batchResults = await Promise.all(
      batch.map((text) => translateOne(text, from, to))
    );
    results.push(...batchResults);
  }
  return results;
}

async function translateOne(text, from, to) {
  // Truncate extremely long text to prevent URL length issues
  const safeText = text.length > 1000 ? text.substring(0, 1000) : text;

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', from);
  url.searchParams.set('tl', to);
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', safeText);

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`翻译服务请求失败 (${response.status})`);
  }

  const data = await response.json();
  // Single text response format: data[0][0][0] is the translation
  // Or data[0] is an array of [translation, original, ...]
  if (data && data[0] && data[0][0]) {
    const item = data[0][0];
    if (typeof item[0] === 'string') return item[0];
    if (Array.isArray(item[0]) && typeof item[0][0] === 'string') return item[0][0];
  }
  return '';
}

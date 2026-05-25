(function () {
  if (document.__translationHelperLoaded) return;
  document.__translationHelperLoaded = true;

  let originalTexts = new Map();
  let translatedTexts = new Map();
  let isTranslating = false;
  let translationObserver = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'translatePage') {
    if (isTranslating) {
      sendResponse({ error: '正在翻译中，请勿重复点击' });
      return false;
    }
    isTranslating = true;
    translatePage(request.from, request.to)
      .then((result) => {
        isTranslating = false;
        sendResponse(result);
      })
      .catch((error) => {
        isTranslating = false;
        sendResponse({ error: error.message });
      });
    return true;
  }
  if (request.action === 'restorePage') {
    restoreOriginal();
    sendResponse({ success: true });
  }
});

async function translatePage(from, to) {
  const textNodes = collectTextNodes();
  console.debug('[翻译助手] 共找到', textNodes.length, '个文本节点');

  if (textNodes.length === 0) {
    return { success: true, count: 0 };
  }

  // Collect texts to translate (always re-scan to catch dynamic content)
  const entries = [];
  let skippedCount = 0;
  for (const node of textNodes) {
    const text = node.textContent.trim();
    if (text.length > 0) {
      if (!originalTexts.has(node)) {
        originalTexts.set(node, text);
      }
      entries.push({ node, text });
    } else {
      skippedCount++;
    }
  }

  console.debug('[翻译助手] 跳过', skippedCount, '个空节点, 待翻译', entries.length, '段');

  if (entries.length === 0) {
    return { success: true, count: 0 };
  }

  chrome.runtime.sendMessage({
    action: 'translateProgress',
    text: `正在翻译 ${entries.length} 段文本...`,
  });

  const totalCount = entries.length;
  let completedCount = 0;
  let actualTranslated = 0;
  let failCount = 0;

  // Translate in batches (each text translated individually in background)
  const BATCH_SIZE = 16;
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batchEntries = entries.slice(i, i + BATCH_SIZE);
    const texts = batchEntries.map((e) => e.text);

    // Retry up to 2 times on failure
    let result = null;
    for (let retry = 0; retry < 2; retry++) {
      try {
        result = await chrome.runtime.sendMessage({
          action: 'translateBatch',
          texts: texts,
          from: from,
          to: to,
        });
        if (result && result.translations) break;
        if (result && result.error && retry === 0) {
          console.warn('[翻译助手] API 返回错误, 重试中:', result.error);
          await new Promise((r) => setTimeout(r, 500));
        }
      } catch (e) {
        console.warn('[翻译助手] API 请求异常, 重试中:', e.message);
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    if (result && result.translations) {
      for (let j = 0; j < batchEntries.length && j < result.translations.length; j++) {
        const translated = result.translations[j];
        if (translated && translated.trim()) {
          batchEntries[j].node.nodeValue = translated;
          translatedTexts.set(batchEntries[j].node, translated);
          actualTranslated++;
        }
      }
      if (result.translations.length < batchEntries.length) {
        failCount += batchEntries.length - result.translations.length;
        console.warn('[翻译助手] 批次返回数不足:', result.translations.length, '/', batchEntries.length);
      }
    } else {
      failCount += batchEntries.length;
      console.error('[翻译助手] 批次完全失败:', result ? (result.error || '未知错误') : '无响应');
    }

    completedCount += batchEntries.length;
    chrome.runtime.sendMessage({
      action: 'translateProgress',
      text: `翻译进度: ${completedCount}/${totalCount}`,
    });
  }

  console.debug('[翻译助手] 翻译完成, 成功:', actualTranslated, '失败:', failCount);

  // Start MutationObserver to guard against framework re-renders
  startTranslationGuard();

  return { success: true, count: actualTranslated };
}

function startTranslationGuard() {
  if (translationObserver) {
    translationObserver.disconnect();
  }

  translationObserver = new MutationObserver((mutations) => {
    let needsReapply = false;
    for (const mutation of mutations) {
      // Text node content changed
      if (mutation.type === 'characterData') {
        const node = mutation.target;
        if (translatedTexts.has(node)) {
          const current = node.nodeValue;
          const original = originalTexts.get(node);
          const translated = translatedTexts.get(node);
          // If framework reverted to original text, re-apply translation
          if (current === original && translated && current !== translated) {
            node.nodeValue = translated;
            needsReapply = true;
          }
        }
      }
      // New child nodes added (framework re-rendered part of the tree)
      if (mutation.type === 'childList') {
        for (const addedNode of mutation.addedNodes) {
          if (addedNode.nodeType === Node.TEXT_NODE) {
            if (translatedTexts.has(addedNode)) {
              const translated = translatedTexts.get(addedNode);
              const original = originalTexts.get(addedNode);
              if (addedNode.nodeValue === original && translated && addedNode.nodeValue !== translated) {
                addedNode.nodeValue = translated;
                needsReapply = true;
              }
            }
          }
          // Check for text nodes inside added elements
          if (addedNode.nodeType === Node.ELEMENT_NODE) {
            const textWalker = document.createTreeWalker(
              addedNode,
              NodeFilter.SHOW_TEXT,
              {
                acceptNode: (n) => {
                  return translatedTexts.has(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                },
              }
            );
            let tn;
            while ((tn = textWalker.nextNode())) {
              if (translatedTexts.has(tn)) {
                const translated = translatedTexts.get(tn);
                const original = originalTexts.get(tn);
                if (tn.nodeValue === original && translated && tn.nodeValue !== translated) {
                  tn.nodeValue = translated;
                  needsReapply = true;
                }
              }
            }
          }
        }
      }
    }
    if (needsReapply) {
      console.debug('[翻译助手] MutationObserver: 重新应用了被框架覆盖的翻译');
    }
  });

  translationObserver.observe(document.body, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  console.debug('[翻译助手] MutationObserver 已启动, 用于防御框架重渲染覆盖');
}

function restoreOriginal() {
  if (translationObserver) {
    translationObserver.disconnect();
    translationObserver = null;
  }
  for (const [node, original] of originalTexts) {
    try {
      node.nodeValue = original;
    } catch (e) {
      // node might be detached
    }
  }
  originalTexts.clear();
  translatedTexts.clear();
}

function collectTextNodes() {
  const nodes = [];
  let skippedTag = 0;
  let skippedHidden = 0;
  let skippedEmpty = 0;

  function shouldSkip(el) {
    if (!el || !el.tagName) return true;
    const tag = el.tagName.toLowerCase();
    return ['script', 'style', 'noscript', 'svg', 'canvas', 'code', 'pre', 'textarea'].includes(tag);
  }

  // First pass: collect ALL text nodes without filtering (avoids acceptNode quirks)
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    nodes.push(node);
  }

  // Second pass: filter
  const filtered = [];
  for (const n of nodes) {
    const parent = n.parentElement;
    if (!parent) continue;
    if (shouldSkip(parent)) { skippedTag++; continue; }
    if (parent.getAttribute && parent.getAttribute('translate') === 'no') { skippedTag++; continue; }
    const text = n.textContent.trim();
    if (text.length === 0) { skippedEmpty++; continue; }

    // Simplified visibility check: only check the parent itself, not all ancestors
    let isVisible = true;
    try {
      const style = window.getComputedStyle(parent);
      if (style.display === 'none' || style.visibility === 'hidden') {
        isVisible = false;
      }
    } catch (e) {
      isVisible = false;
    }

    if (!isVisible) { skippedHidden++; continue; }
    filtered.push(n);
  }

  console.debug('[翻译助手] 节点统计: 总计', nodes.length, '跳过元素', skippedTag, '隐藏', skippedHidden, '空', skippedEmpty, '保留', filtered.length);
  return filtered;
}
})();

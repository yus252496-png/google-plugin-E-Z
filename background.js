// Background script: minimal — only handles sidePanel activation
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

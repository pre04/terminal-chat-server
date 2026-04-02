const serverUrlInput = document.getElementById('server-url');
const saveBtn        = document.getElementById('save-btn');
const statusEl       = document.getElementById('status');

// Load saved settings
chrome.storage.local.get(['serverUrl'], prefs => {
  if (prefs.serverUrl) serverUrlInput.value = prefs.serverUrl;
});

saveBtn.addEventListener('click', () => {
  const serverUrl = serverUrlInput.value.trim();
  chrome.storage.local.set({ serverUrl }, () => {
    statusEl.style.display = 'block';
    setTimeout(() => { statusEl.style.display = 'none'; }, 2500);
  });
});

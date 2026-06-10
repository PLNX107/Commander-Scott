/* ============================================================
   data/import-export.js — JSON backup & restore
   ============================================================ */

'use strict';

function exportData() {
  try {
    const exportObj = {
      version: 1,
      exportedAt: new Date().toISOString(),
      appName: 'CMD Counter',
      state: JSON.parse(JSON.stringify(state)),
    };

    const json     = JSON.stringify(exportObj, null, 2);
    const blob     = new Blob([json], { type: 'application/json' });
    const url      = URL.createObjectURL(blob);
    const dateStr  = new Date().toISOString().slice(0, 10);
    const filename = `cmd-counter-backup-${dateStr}.json`;

    const a = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    // Record export time
    state.lastExport = new Date().toISOString();
    saveDB(state);

    document.getElementById('io-status').textContent = '✓ Exported: ' + filename;
    showToast('✓ Backup exported!');
  } catch (err) {
    document.getElementById('io-status').textContent = '✗ Export failed: ' + err.message;
  }
}

async function importData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const statusEl = document.getElementById('io-status');
  statusEl.textContent = 'Reading file…';

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);

    // Validate
    if (!parsed.state || !parsed.state.players) {
      throw new Error('Invalid backup file format');
    }

    // Version check
    if (parsed.version !== 1) {
      throw new Error('Unsupported backup version: ' + parsed.version);
    }

    state = parsed.state;
    state.gameStarted = !!state.players.length;
    await saveDB(state);

    statusEl.textContent = '✓ Loaded backup from ' + (parsed.exportedAt
      ? new Date(parsed.exportedAt).toLocaleDateString()
      : 'unknown date');

    showToast('✓ Backup loaded!');

    // Close overlay and go to appropriate screen
    setTimeout(() => {
      closeImportExport();
      if (state.gameStarted) {
        showScreen('game');
        renderGame();
      } else {
        setupPlayerCount = state.playerCount || 4;
        setupFormat = state.format || 'commander';
        renderSetup();
        showScreen('setup');
      }
    }, 1200);
  } catch (err) {
    statusEl.textContent = '✗ Import failed: ' + err.message;
    showToast('✗ Import failed');
  }

  // Reset file input so same file can be re-imported
  event.target.value = '';
}

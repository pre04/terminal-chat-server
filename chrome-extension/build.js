#!/usr/bin/env node
// Copies shared modules from public/js/ into the extension's js/ directory.
// Run once before loading the extension: node build.js

const fs = require('fs');
const path = require('path');

const SRC  = path.join(__dirname, '..', 'public', 'js');
const DEST = path.join(__dirname, 'js');

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

const files = ['utils.js', 'chat-core.js'];
files.forEach(f => {
    fs.copyFileSync(path.join(SRC, f), path.join(DEST, f));
    console.log(`Copied: ${f}`);
});
console.log('Build complete. Load the extension from this directory.');

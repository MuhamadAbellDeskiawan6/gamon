const fs = require('fs');
const path = require('path');
const assert = require('assert');
const test = require('node:test');

test('profile page supports photo upload and user avatars use photo URLs when available', () => {
  const profilHtml = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'user', 'profil.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(profilHtml, /type="file".*accept="image\//i, 'Expected a profile photo file input in the profile page');
  assert.match(profilHtml, /data-profile-file-name|Nama file/i, 'Expected a selected file label in the profile photo picker');
  assert.match(appJs, /getStorage|uploadBytes|getDownloadURL|photoUrl/i, 'Expected Firebase Storage logic for uploading and saving a profile photo');
  assert.match(appJs, /renderAvatar|avatar.*photo|photoUrl.*avatar|user\.photoUrl/i, 'Expected avatar rendering logic to prefer a profile photo when present');
  assert.match(appJs, /file:\/\/|CORS|localStorage.*profile|upload.*fallback/i, 'Expected a local fallback for blocked file-origin uploads so saving profile still works');
  assert.match(appJs, /profile.*file.*name|selected.*file|data-profile-file-name/i, 'Expected selected-file status handling so the user sees the latest chosen image before saving');
});

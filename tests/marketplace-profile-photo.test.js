const fs = require('fs');
const path = require('path');
const assert = require('assert');
const test = require('node:test');

test('profile page supports profile photo upload and stores a user photo value', () => {
  const profileHtml = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'user', 'profil.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(profileHtml, /profilePhoto|photoPreview|profile.*photo/i, 'Expected a profile photo input and preview section in the profile form');
  assert.match(appJs, /user\.photo|photo\s*:/i, 'Expected user photo data to be stored in the user object');
  assert.match(appJs, /fileToDataUrl|FileReader|readAsDataURL/i, 'Expected profile photo to be read from the selected file before saving');
});

test('product cards prefer seller profile photos with initials fallback', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(appJs, /sellerPhoto/i, 'Expected sellerPhoto to be part of normalized product data');
  assert.match(appJs, /renderSellerAvatarMarkup/i, 'Expected a dedicated seller avatar renderer');
  assert.match(appJs, /avatar-photo.*img|<img src="\$\{sellerPhoto\}"/i, 'Expected product cards to render a seller photo when available');
});

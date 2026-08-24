const fs = require('fs');
const path = require('path');
const assert = require('assert');
const test = require('node:test');

test('marketplace product payload keeps seller photo so avatars show on other devices', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(appJs, /sellerPhotoUrl\s*:/i, 'Expected product payload to store sellerPhotoUrl');
  assert.match(appJs, /sellerPhotoUrl:\s*getUserPhotoUrl\(user\)\s*\|\|\s*''/i, 'Expected seller photo to be copied into product when created');
  assert.match(appJs, /normalized\.sellerPhotoUrl|sellerPhoto\s*\|\|\s*getUserPhotoUrl\(sellerUser/i, 'Expected product seller photo to be used before falling back to lookup');
  assert.match(appJs, /migrateExistingProductSellerPhotos|repair.*seller.*photo/i, 'Expected automatic migration for existing products missing seller photos');
  assert.match(appJs, /await\s+migrateExistingProductSellerPhotos\s*\(/i, 'Expected migration to run during startup');
});

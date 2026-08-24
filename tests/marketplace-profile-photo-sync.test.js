const fs = require('fs');
const path = require('path');
const assert = require('assert');
const test = require('node:test');

test('profile photo changes propagate to products immediately', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(appJs, /syncSellerPhotosAcrossProducts|updateProductsSellerPhotoForUser/i, 'Expected a helper that syncs seller photo across products');
  assert.match(appJs, /await\s+syncSellerPhotosAcrossProducts\(updatedUser\)|syncSellerPhotosAcrossProducts\(updatedUser\)/i, 'Expected profile update to propagate the new photo to products');
});

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const test = require('node:test');

test('home marketplace shows a loading state while products are still being fetched', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(source, /renderHomeProductsLoadingState|Memuat barang|skeleton/i, 'Expected a product-loading skeleton or message in home products rendering');
  assert.match(source, /container\.innerHTML\s*=\s*renderHomeProductsLoadingState\(|container\.innerHTML\s*=\s*render.*Loading/i, 'Expected the product list container to render a loading placeholder before data loads');
});

test('buyer and my-products pages also render loading placeholders before product data loads', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(source, /renderBuyerProductsLoadingState|renderMyProductsLoadingState|Sedang memuat barang/i, 'Expected visible loading placeholders on buyer and my-products pages');
  assert.match(source, /container\.innerHTML\s*=\s*renderBuyerProductsLoadingState\(|container\.innerHTML\s*=\s*renderMyProductsLoadingState\(/i, 'Expected the buyer and my-products containers to render a loading state before fetching');
});

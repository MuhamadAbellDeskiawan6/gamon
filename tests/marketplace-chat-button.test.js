const fs = require('fs');
const path = require('path');
const assert = require('assert');
const test = require('node:test');

test('public product page includes a chat button that redirects unauthenticated visitors to login', () => {
  const productHtml = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'product.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');

  assert.match(productHtml, /data-chat-product/i, 'Expected a chat button on the public product page');
  assert.match(productHtml, /href="login\.html"/i, 'Expected login redirect for the public product-page chat button');
  assert.match(appJs, /!isUserPage && !currentUserData/i, 'Expected public product pages to detect unauthenticated users before chat');
  assert.match(appJs, /getAuthTarget\(\)/i, 'Expected a login redirect helper to be used for the public chat CTA');
});

test('product-specific chat links carry product context and the chat UI shows a product marker', () => {
  const appJs = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'assets', 'app.js'), 'utf8');
  const chatHtml = fs.readFileSync(path.join(__dirname, '..', 'marketplace', 'user', 'chat.html'), 'utf8');

  assert.match(appJs, /productId/i, 'Expected product ID support in the chat URL builder');
  assert.match(appJs, /getUserChatUrl\s*\(/i, 'Expected the seller chat URL helper to be present');
  assert.match(appJs, /getChatThreadId\s*\(.*productId/i, 'Expected product-specific thread IDs to separate chats per product');
  assert.match(appJs, /data-thread-product-id|Produk:/i, 'Expected the chat list to show the product context for each thread');
  assert.match(chatHtml, /data-chat-product-context/i, 'Expected the chat page to have a dedicated product context element');
});

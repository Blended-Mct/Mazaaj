// Fills {{origin}} in the docs examples with this server's address.
for (const el of document.querySelectorAll('pre code')) {
  el.textContent = el.textContent.replaceAll('{{origin}}', location.origin);
}

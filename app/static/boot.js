// Boot: runs after all page modules have registered their routes.
window.addEventListener('hashchange', render);
renderBanner();
render();

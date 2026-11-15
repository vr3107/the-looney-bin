// Runs before the app loads: sends visitors who aren't signed in to the sign-in
// page and points the app at the signed-in person's own data in this browser.
(function () {
  var user = lbCurrentUser();
  if (!user) {
    location.replace("/signin");
    // Stop the rest of the page from flashing while redirecting.
    document.documentElement.style.visibility = "hidden";
    return;
  }
  window.LB_USER = user;
  window.LB_STORAGE_KEY = lbDataKey(user.id);
  window.LB_FILES_DB = lbFilesDb(user.id);
})();

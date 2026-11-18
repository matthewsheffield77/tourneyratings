// TourneyRatings client script -- the only JavaScript on the site.
// Jobs: the tournament share button, and keeping the "Find tournaments
// for your player" match count live on the calendar page. Filtering
// itself is done server-side on submit, so the page works without JS.

// Share button: native share sheet where available, otherwise copy the
// link and say so on the button for a couple of seconds.
(function () {
  var btn = document.querySelector(".share-btn");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var url =
      window.location.origin +
      (btn.getAttribute("data-path") || window.location.pathname);
    var title = btn.getAttribute("data-title") || document.title;
    if (navigator.share) {
      navigator.share({ title: title, url: url }).catch(function () {});
      return;
    }
    function done() {
      var old = btn.textContent;
      btn.textContent = "Link copied!";
      setTimeout(function () {
        btn.textContent = old;
      }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, done);
    }
  });
})();

(function () {
  var dataEl = document.getElementById("myplayer-data");
  var countEl = document.getElementById("myplayer-count");
  if (!dataEl || !countEl) return;

  var tournaments;
  try {
    tournaments = JSON.parse(dataEl.textContent);
  } catch (e) {
    return;
  }

  function selected(name) {
    return Array.prototype.slice
      .call(document.querySelectorAll('input[name="' + name + '"]:checked'))
      .map(function (el) { return el.value; });
  }

  function update() {
    var ages = selected("myAges");
    var levels = selected("myLevels");
    var divs = selected("myDivs");
    if (ages.length === 0 && levels.length === 0 && divs.length === 0) {
      countEl.textContent = "No player selected — showing everything.";
      return;
    }
    var n = tournaments.filter(function (t) {
      var ageOk = ages.length === 0 || ages.some(function (a) { return t.ages.indexOf(a) !== -1; });
      var levelOk = levels.length === 0 || levels.some(function (l) { return t.levels.indexOf(l) !== -1; });
      var divOk = divs.length === 0 || divs.some(function (d) { return (t.divs || ["Youth"]).indexOf(d) !== -1; });
      return ageOk && levelOk && divOk;
    }).length;
    countEl.textContent =
      n + " tournament" + (n === 1 ? "" : "s") + " match your player — hit “Apply filters” to narrow the list.";
  }

  document.querySelectorAll('input[name="myAges"], input[name="myLevels"], input[name="myDivs"]').forEach(function (el) {
    el.addEventListener("change", update);
  });
})();

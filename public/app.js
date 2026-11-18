// TourneyRatings client script -- the only JavaScript on the site.
// Job: keep the "Find tournaments for your player" match count live on
// the tournament calendar as age/level checkboxes change. Filtering
// itself is done server-side on submit, so the page works without JS.
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

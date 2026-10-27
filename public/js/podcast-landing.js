(function () {
  'use strict';

  const podcastSlug = document.body.dataset.podcast;
  if (!podcastSlug) return;

  const latestTitle = document.getElementById('latest-episode-title');
  const latestMeta = document.getElementById('latest-episode-meta');
  const latestSummary = document.getElementById('latest-episode-summary');
  const latestAudio = document.getElementById('latest-episode-audio');
  const latestListen = document.getElementById('latest-episode-link');
  const latestShowNotes = document.getElementById('latest-episode-notes');
  const episodeList = document.getElementById('episode-list');
  const episodeResults = document.getElementById('episode-results');
  const episodeSearch = document.getElementById('episode-search');
  const episodeCount = document.getElementById('episode-count');
  const feedStatus = document.getElementById('feed-status');
  const episodePagination = document.getElementById('episode-pagination');

  const PAGE_SIZE = 8;
  let currentPage = 1;
  let activeFeed = readSeedData();
  const notesCache = new Map();
  let latestEpisodeRef = null;
  let latestNotesPanel = null;
  const miniPlayer = createMiniPlayer();

  wireLatestEpisodeControls();

  renderFeed(activeFeed, {
    status: activeFeed.episodes?.length
      ? 'Showing featured episodes while the live RSS archive loads.'
      : 'Connecting to the live RSS archive\u2026',
    statusClass: '',
  });

  loadLiveFeed();

  if (episodeSearch) {
    episodeSearch.addEventListener('input', () => {
      currentPage = 1;
      renderEpisodeList(activeFeed.episodes || []);
    });
  }

  function readSeedData() {
    const seedNode = document.getElementById('podcast-feed-seed');
    if (!seedNode) return { podcast: {}, episodes: [] };

    try {
      const parsed = JSON.parse(seedNode.textContent || '{}');
      return {
        podcast: parsed.podcast || {},
        episodes: Array.isArray(parsed.episodes) ? parsed.episodes : [],
      };
    } catch {
      return { podcast: {}, episodes: [] };
    }
  }

  async function loadLiveFeed() {
    const feedUrls = getFeedUrls();
    let lastFeedError = null;

    try {
      for (const feedUrl of feedUrls) {
        const response = await fetch(feedUrl, {
          headers: { Accept: 'application/json' },
        });

        if (!response.ok) {
          lastFeedError = 'HTTP ' + response.status + ' from ' + feedUrl;
          continue;
        }

        const liveFeed = await response.json();
        if (!Array.isArray(liveFeed.episodes) || !liveFeed.episodes.length) {
          lastFeedError = 'No episodes returned from ' + feedUrl;
          continue;
        }

        activeFeed = liveFeed;
        currentPage = 1;
        renderFeed(activeFeed, {
          status: 'Live RSS feed connected. The archive below updates automatically from the podcast feed.',
          statusClass: 'is-live',
        });
        return;
      }

      throw new Error(lastFeedError || 'No live podcast feed endpoint returned episodes after trying ' + feedUrls.length + ' URL(s)');
    } catch (error) {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          'Podcast feed unavailable for ' + podcastSlug + ': ' + (lastFeedError || (error && error.message) || 'Unknown error'),
          error
        );
      }
      renderFeed(activeFeed, {
        status: 'The live RSS archive is temporarily unavailable. You can still use the listening links below while we reconnect.',
        statusClass: activeFeed.episodes?.length ? '' : 'is-error',
      });
    }
  }

  function getFeedUrls() {
    const query = 'show=' + encodeURIComponent(podcastSlug);
    const urls = ['/api/podcast-feed?' + query];
    const mainSiteOrigin = 'https://dolifetoday.com';

    if (window.location.origin !== mainSiteOrigin) {
      urls.push(mainSiteOrigin + '/api/podcast-feed?' + query);
    }

    return urls;
  }

  function renderFeed(feed, options) {
    renderStatus(options.status, options.statusClass);
    renderLatestEpisode(feed.episodes || []);
    renderEpisodeList(feed.episodes || []);

    if (episodeCount) {
      const count = feed.podcast?.episodeCount || (feed.episodes || []).length;
      episodeCount.textContent = count ? count + '+ episodes' : 'Episode archive loading';
    }
  }

  function renderStatus(message, statusClass) {
    if (!feedStatus) return;
    feedStatus.textContent = message;
    feedStatus.className = 'feed-status';
    if (statusClass) feedStatus.classList.add(statusClass);
  }

  function renderLatestEpisode(episodes) {
    const latestEpisode = episodes[0];
    if (latestEpisodeRef && (!latestEpisode || latestEpisode.id !== latestEpisodeRef.id) && latestNotesPanel) {
      latestNotesPanel.hidden = true;
      latestNotesPanel.innerHTML = '';
      delete latestNotesPanel.dataset.loadedFor;
    }
    latestEpisodeRef = latestEpisode || null;
    if (!latestEpisode) {
      if (latestTitle) latestTitle.textContent = 'Episode details are loading';
      if (latestSummary) latestSummary.textContent = 'We are connecting to the RSS feed so you can play the latest episode right from this page.';
      if (latestMeta) latestMeta.innerHTML = '';
      if (latestAudio) latestAudio.hidden = true;
      if (latestListen) {
        latestListen.textContent = 'Open Spotify';
        latestListen.href = latestListen.dataset.fallbackHref || '#';
      }
      if (latestShowNotes) {
        latestShowNotes.hidden = true;
        latestShowNotes.style.display = 'none';
        latestShowNotes.setAttribute('aria-hidden', 'true');
      }
      return;
    }

    if (latestTitle) latestTitle.textContent = latestEpisode.title || 'Latest episode';
    if (latestSummary) {
      latestSummary.textContent = latestEpisode.summary || 'Tap play to listen to the most recent conversation from the show.';
    }

    if (latestMeta) {
      latestMeta.innerHTML = '';
      buildMetaPill(latestEpisode.publishedAtIso || latestEpisode.publishedAt, formatDate(latestEpisode.publishedAtIso || latestEpisode.publishedAt));
      buildMetaPill(latestEpisode.duration, latestEpisode.duration);
      buildMetaPill(latestEpisode.episodeNumber, 'Episode ' + latestEpisode.episodeNumber);
    }

    if (latestAudio && latestEpisode.audioUrl) {
      latestAudio.hidden = false;
      latestAudio.src = latestEpisode.audioUrl;
    } else if (latestAudio) {
      latestAudio.hidden = true;
      latestAudio.removeAttribute('src');
    }

    if (latestListen) {
      latestListen.href = latestEpisode.audioUrl || latestEpisode.link || latestListen.dataset.fallbackHref || '#';
      latestListen.textContent = latestEpisode.audioUrl ? 'Play the latest episode' : 'Listen on Spotify';
    }

    if (latestShowNotes) {
      if (latestEpisode.link || latestEpisode.summary) {
        latestShowNotes.hidden = false;
        latestShowNotes.style.display = '';
        latestShowNotes.setAttribute('aria-hidden', 'false');
        latestShowNotes.href = latestEpisode.link || '#';
        if (!latestNotesPanel || latestNotesPanel.hidden) {
          latestShowNotes.textContent = 'Show notes';
          latestShowNotes.setAttribute('aria-expanded', 'false');
        }
      } else {
        latestShowNotes.hidden = true;
        latestShowNotes.style.display = 'none';
        latestShowNotes.setAttribute('aria-hidden', 'true');
      }
    }

    function buildMetaPill(value, label) {
      if (!value || !label) return;
      const metaItem = document.createElement('span');
      metaItem.textContent = label;
      latestMeta.appendChild(metaItem);
    }
  }

  function renderEpisodeList(episodes) {
    if (!episodeList || !episodeResults) return;

    const query = (episodeSearch?.value || '').trim().toLowerCase();
    const filteredEpisodes = episodes.filter(function (episode) {
      if (!query) return true;
      return (((episode.title || '') + ' ' + (episode.summary || '')).toLowerCase()).includes(query);
    });

    var totalPages = Math.max(1, Math.ceil(filteredEpisodes.length / PAGE_SIZE));
    if (currentPage > totalPages) currentPage = totalPages;
    var startIdx = (currentPage - 1) * PAGE_SIZE;
    var pageEpisodes = filteredEpisodes.slice(startIdx, startIdx + PAGE_SIZE);

    episodeResults.textContent = query
      ? 'Showing ' + filteredEpisodes.length + ' result' + (filteredEpisodes.length === 1 ? '' : 's') + ' for "' + query + '".'
      : 'Browse ' + episodes.length + ' episode' + (episodes.length === 1 ? '' : 's') + ' from the RSS archive.';

    episodeList.innerHTML = '';

    if (!filteredEpisodes.length) {
      var emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No episodes matched that search yet. Try another keyword such as movement, diagnosis, medication, or community.';
      episodeList.appendChild(emptyState);
      renderPagination(0, 1);
      return;
    }

    pageEpisodes.forEach(function (episode) {
      var article = document.createElement('article');
      article.className = 'podcast-episode-card';

      var top = document.createElement('div');
      top.className = 'episode-card-top';

      if (episode.episodeNumber) {
        var number = document.createElement('span');
        number.className = 'episode-number-pill';
        number.textContent = 'EP ' + episode.episodeNumber;
        top.appendChild(number);
      }

      var meta = document.createElement('div');
      meta.className = 'episode-card-meta';

      var dateLabel = formatDate(episode.publishedAtIso || episode.publishedAt);
      if (dateLabel) {
        var date = document.createElement('span');
        date.textContent = dateLabel;
        meta.appendChild(date);
      }

      if (episode.duration) {
        var duration = document.createElement('span');
        duration.textContent = episode.duration;
        meta.appendChild(duration);
      }

      if (meta.childNodes.length) top.appendChild(meta);

      var title = document.createElement('h3');
      title.className = 'episode-card-title';
      title.textContent = episode.title || 'Episode title';

      var summary = document.createElement('p');
      summary.className = 'episode-card-summary';
      summary.textContent = episode.summary || 'Listen to the full episode for the complete conversation.';

      var actions = document.createElement('div');
      actions.className = 'episode-card-actions';

      var primaryAction = document.createElement('a');
      primaryAction.className = 'btn btn-primary btn-sm';
      primaryAction.href = episode.audioUrl || episode.link || '#';
      primaryAction.textContent = episode.audioUrl ? 'Listen now' : 'Open episode';
      if (primaryAction.href !== '#') {
        primaryAction.target = '_blank';
        primaryAction.rel = 'noopener noreferrer';
      }
      if (episode.audioUrl) {
        // Play here in the sticky player; the href stays as a fallback for
        // new-tab / no-JS clicks.
        primaryAction.addEventListener('click', function (event) {
          if (!isPlainClick(event)) return;
          event.preventDefault();
          miniPlayer.play(episode, article, primaryAction);
        });
        if (miniPlayer.isCurrent(episode)) miniPlayer.attach(article, primaryAction);
      }
      actions.appendChild(primaryAction);

      var notesPanel = null;
      if (episode.link || episode.summary) {
        var notesToggle = document.createElement('button');
        notesToggle.type = 'button';
        notesToggle.className = 'btn btn-secondary btn-sm';
        notesToggle.textContent = 'Show notes';
        notesToggle.setAttribute('aria-expanded', 'false');
        notesPanel = document.createElement('div');
        notesPanel.className = 'episode-notes';
        notesPanel.hidden = true;
        notesToggle.addEventListener('click', function () {
          toggleNotes(episode, notesPanel, notesToggle);
        });
        actions.appendChild(notesToggle);
      }

      article.append(top, title, summary, actions);
      if (notesPanel) article.appendChild(notesPanel);
      episodeList.appendChild(article);
    });

    renderPagination(totalPages, currentPage);
  }

  function renderPagination(totalPages, page) {
    if (!episodePagination) return;
    episodePagination.innerHTML = '';
    if (totalPages <= 1) return;

    var prevBtn = document.createElement('button');
    prevBtn.className = 'btn btn-secondary btn-sm';
    prevBtn.textContent = '\u2190 Previous';
    prevBtn.disabled = page <= 1;
    prevBtn.addEventListener('click', function () {
      if (currentPage > 1) {
        currentPage--;
        renderEpisodeList(activeFeed.episodes || []);
        scrollToEpisodes();
      }
    });

    var pageInfo = document.createElement('span');
    pageInfo.style.cssText = 'font-weight:600;color:var(--clr-text,#fff);';
    pageInfo.textContent = 'Page ' + page + ' of ' + totalPages;

    var nextBtn = document.createElement('button');
    nextBtn.className = 'btn btn-secondary btn-sm';
    nextBtn.textContent = 'Next \u2192';
    nextBtn.disabled = page >= totalPages;
    nextBtn.addEventListener('click', function () {
      if (currentPage < totalPages) {
        currentPage++;
        renderEpisodeList(activeFeed.episodes || []);
        scrollToEpisodes();
      }
    });

    episodePagination.append(prevBtn, pageInfo, nextBtn);
  }

  function scrollToEpisodes() {
    var target = document.getElementById('episodes');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function isPlainClick(event) {
    return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  }

  // ── On-page playback ────────────────────────────────────────────────
  // "Listen now" plays in a sticky bar at the bottom of the page (same bar
  // as /podcasts) instead of opening the raw MP3 in a new tab.
  function createMiniPlayer() {
    var bar = document.getElementById('audio-player');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'audio-player-bar';
      bar.id = 'audio-player';
      bar.innerHTML =
        '<div class="audio-player-inner">' +
        '<button class="ap-btn" id="ap-play-pause" type="button" aria-label="Play or pause">&#9654;</button>' +
        '<div class="ap-track-info"><div class="ap-title" id="ap-title"></div><div class="ap-show" id="ap-show"></div></div>' +
        '<div class="ap-progress-wrap"><span class="ap-time" id="ap-current">0:00</span>' +
        '<div class="ap-progress" id="ap-progress"><div class="ap-progress-fill" id="ap-fill"></div></div>' +
        '<span class="ap-time" id="ap-duration">0:00</span></div>' +
        '<button class="ap-close" id="ap-close" type="button" aria-label="Close player">&times;</button>' +
        '</div><audio id="ap-audio" preload="none"></audio>';
      document.body.appendChild(bar);
    }

    var audio = bar.querySelector('#ap-audio');
    var toggleBtn = bar.querySelector('#ap-play-pause');
    var titleEl = bar.querySelector('#ap-title');
    var showEl = bar.querySelector('#ap-show');
    var curEl = bar.querySelector('#ap-current');
    var durEl = bar.querySelector('#ap-duration');
    var progress = bar.querySelector('#ap-progress');
    var fill = bar.querySelector('#ap-fill');
    var closeBtn = bar.querySelector('#ap-close');
    var currentId = null;
    var cardEl = null;
    var buttonEl = null;

    function fmtTime(seconds) {
      if (!seconds || isNaN(seconds)) return '0:00';
      var m = Math.floor(seconds / 60);
      var s = Math.floor(seconds % 60);
      return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function reflectState() {
      var playing = !audio.paused && !audio.ended;
      toggleBtn.innerHTML = playing ? '&#9646;&#9646;' : '&#9654;';
      if (cardEl) cardEl.classList.toggle('now-playing', !!currentId);
      if (buttonEl) {
        buttonEl.classList.toggle('is-playing', playing);
        buttonEl.textContent = playing ? 'Pause' : 'Listen now';
      }
    }

    function detach() {
      if (cardEl) cardEl.classList.remove('now-playing');
      if (buttonEl) {
        buttonEl.classList.remove('is-playing');
        buttonEl.textContent = 'Listen now';
      }
      cardEl = null;
      buttonEl = null;
    }

    audio.addEventListener('play', reflectState);
    audio.addEventListener('pause', reflectState);
    audio.addEventListener('ended', reflectState);
    audio.addEventListener('timeupdate', function () {
      curEl.textContent = fmtTime(audio.currentTime);
      if (audio.duration) fill.style.width = (audio.currentTime / audio.duration * 100) + '%';
    });
    audio.addEventListener('loadedmetadata', function () {
      durEl.textContent = fmtTime(audio.duration);
    });
    toggleBtn.addEventListener('click', function () {
      if (!audio.src) return;
      if (audio.paused) audio.play().catch(function () {});
      else audio.pause();
    });
    progress.addEventListener('click', function (event) {
      if (!audio.duration) return;
      var rect = progress.getBoundingClientRect();
      audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
    });
    closeBtn.addEventListener('click', function () {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      currentId = null;
      detach();
      bar.classList.remove('is-visible');
      document.body.classList.remove('has-audio-player');
    });

    return {
      play: function (episode, card, button) {
        if (currentId === episode.id) {
          if (cardEl !== card || buttonEl !== button) {
            detach();
            cardEl = card;
            buttonEl = button;
          }
          if (audio.paused) audio.play().catch(function () {});
          else audio.pause();
          return;
        }
        detach();
        currentId = episode.id;
        cardEl = card;
        buttonEl = button;
        titleEl.textContent = episode.title || 'Episode';
        showEl.textContent = (activeFeed.podcast && activeFeed.podcast.title) || '';
        curEl.textContent = '0:00';
        durEl.textContent = '0:00';
        fill.style.width = '0';
        bar.classList.add('is-visible');
        document.body.classList.add('has-audio-player');
        if (latestAudio && !latestAudio.paused) latestAudio.pause();
        audio.src = episode.audioUrl;
        audio.play().catch(function () {});
        reflectState();
      },
      // Re-link the playing episode to its card after the list re-renders
      // (search, paging, live feed replacing the seed).
      isCurrent: function (episode) {
        return !!currentId && episode.id === currentId;
      },
      attach: function (card, button) {
        cardEl = card;
        buttonEl = button;
        reflectState();
      },
      pause: function () {
        if (!audio.paused) audio.pause();
      },
    };
  }

  function wireLatestEpisodeControls() {
    if (latestListen) {
      latestListen.addEventListener('click', function (event) {
        if (!isPlainClick(event) || !latestAudio || !latestEpisodeRef || !latestEpisodeRef.audioUrl) return;
        event.preventDefault();
        miniPlayer.pause();
        latestAudio.hidden = false;
        latestAudio.play().catch(function () {});
      });
    }
    if (latestAudio) {
      latestAudio.addEventListener('play', function () { miniPlayer.pause(); });
    }
    if (latestShowNotes) {
      latestNotesPanel = document.createElement('div');
      latestNotesPanel.className = 'episode-notes';
      latestNotesPanel.hidden = true;
      var group = latestShowNotes.parentElement;
      if (group && group.parentElement) group.parentElement.insertBefore(latestNotesPanel, group.nextSibling);
      latestShowNotes.setAttribute('role', 'button');
      latestShowNotes.setAttribute('aria-expanded', 'false');
      latestShowNotes.addEventListener('click', function (event) {
        if (!isPlainClick(event) || !latestEpisodeRef) return;
        event.preventDefault();
        toggleNotes(latestEpisodeRef, latestNotesPanel, latestShowNotes);
      });
    }
  }

  // ── Inline show notes ───────────────────────────────────────────────
  function toggleNotes(episode, panel, toggle) {
    if (!panel) return;
    if (!panel.hidden) {
      panel.hidden = true;
      toggle.textContent = 'Show notes';
      toggle.setAttribute('aria-expanded', 'false');
      return;
    }
    panel.hidden = false;
    toggle.textContent = 'Hide notes';
    toggle.setAttribute('aria-expanded', 'true');
    if (panel.dataset.loadedFor === episode.id) return;
    panel.dataset.loadedFor = episode.id;
    renderNotes(panel, episode, null, true);
    loadNotes(episode)
      .then(function (notes) {
        if (panel.dataset.loadedFor === episode.id) renderNotes(panel, episode, notes, false);
      })
      .catch(function () {
        if (panel.dataset.loadedFor === episode.id) renderNotes(panel, episode, episode.summary, false);
      });
  }

  function loadNotes(episode) {
    if (notesCache.has(episode.id)) return Promise.resolve(notesCache.get(episode.id));
    var urls = getFeedUrls().map(function (url) {
      return url + '&episode=' + encodeURIComponent(episode.id);
    });
    function attempt(index) {
      if (index >= urls.length) return Promise.reject(new Error('Show notes unavailable'));
      return fetch(urls[index], { headers: { Accept: 'application/json' } })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (data) {
          var notes = data && data.episode && data.episode.notes;
          if (!notes) return attempt(index + 1);
          notesCache.set(episode.id, notes);
          return notes;
        }, function () { return attempt(index + 1); });
    }
    return attempt(0);
  }

  function renderNotes(panel, episode, text, loading) {
    panel.innerHTML = '';
    var body = document.createElement('div');
    body.className = 'episode-notes-body';
    if (loading) {
      body.textContent = 'Loading show notes\u2026';
    } else {
      appendLinkified(body, text || episode.summary || 'No show notes for this episode yet.');
    }
    panel.appendChild(body);
    if (!loading && episode.link) {
      var more = document.createElement('a');
      more.className = 'episode-notes-link';
      more.href = episode.link;
      more.target = '_blank';
      more.rel = 'noopener noreferrer';
      more.textContent = 'Open this episode on Spotify \u2197';
      panel.appendChild(more);
    }
  }

  // Plain text with http(s) URLs turned into links — built with DOM nodes,
  // never innerHTML, since notes come from the RSS feed.
  function appendLinkified(container, text) {
    var parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
    parts.forEach(function (part) {
      if (/^https?:\/\//.test(part)) {
        var trimmed = part.replace(/[.,;:!?)\]]+$/, '');
        var a = document.createElement('a');
        a.href = trimmed;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = trimmed;
        container.appendChild(a);
        if (trimmed.length < part.length) container.appendChild(document.createTextNode(part.slice(trimmed.length)));
      } else if (part) {
        container.appendChild(document.createTextNode(part));
      }
    });
  }

  function formatDate(value) {
    if (!value) return '';
    var parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed);
  }
})();

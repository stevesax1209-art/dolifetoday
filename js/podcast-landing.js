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

  let activeFeed = readSeedData();

  renderFeed(activeFeed, {
    status: activeFeed.episodes?.length
      ? 'Showing featured episodes while the live RSS archive loads.'
      : 'Connecting to the live RSS archive…',
    statusClass: '',
  });

  loadLiveFeed();

  if (episodeSearch) {
    episodeSearch.addEventListener('input', () => renderEpisodeList(activeFeed.episodes || []));
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
    try {
      const response = await fetch(`/api/podcast-feed?show=${encodeURIComponent(podcastSlug)}`, {
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const liveFeed = await response.json();
      if (!Array.isArray(liveFeed.episodes) || !liveFeed.episodes.length) {
        throw new Error('No episodes returned');
      }

      activeFeed = liveFeed;
      renderFeed(activeFeed, {
        status: 'Live RSS feed connected. The archive below updates automatically from the podcast feed.',
        statusClass: 'is-live',
      });
    } catch {
      renderFeed(activeFeed, {
        status: 'The live RSS archive is temporarily unavailable. You can still use the listening links below while we reconnect.',
        statusClass: activeFeed.episodes?.length ? '' : 'is-error',
      });
    }
  }

  function renderFeed(feed, options) {
    renderStatus(options.status, options.statusClass);
    renderLatestEpisode(feed.episodes || []);
    renderEpisodeList(feed.episodes || []);

    if (episodeCount) {
      const count = feed.podcast?.episodeCount || (feed.episodes || []).length;
      episodeCount.textContent = count ? `${count}+ episodes` : 'Episode archive loading';
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
      buildMetaPill(latestEpisode.episodeNumber, `Episode ${latestEpisode.episodeNumber}`);
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
      if (latestEpisode.link && latestEpisode.audioUrl && latestEpisode.link !== latestEpisode.audioUrl) {
        latestShowNotes.hidden = false;
        latestShowNotes.style.display = '';
        latestShowNotes.setAttribute('aria-hidden', 'false');
        latestShowNotes.href = latestEpisode.link;
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
    const filteredEpisodes = episodes.filter((episode) => {
      if (!query) return true;
      return `${episode.title || ''} ${episode.summary || ''}`.toLowerCase().includes(query);
    });

    episodeResults.textContent = query
      ? `Showing ${filteredEpisodes.length} result${filteredEpisodes.length === 1 ? '' : 's'} for “${query}”.`
      : `Browse ${episodes.length} episode${episodes.length === 1 ? '' : 's'} from the RSS archive.`;

    episodeList.innerHTML = '';

    if (!filteredEpisodes.length) {
      const emptyState = document.createElement('div');
      emptyState.className = 'empty-state';
      emptyState.textContent = 'No episodes matched that search yet. Try another keyword such as movement, diagnosis, medication, or community.';
      episodeList.appendChild(emptyState);
      return;
    }

    filteredEpisodes.forEach((episode) => {
      const article = document.createElement('article');
      article.className = 'podcast-episode-card';

      const top = document.createElement('div');
      top.className = 'episode-card-top';

      if (episode.episodeNumber) {
        const number = document.createElement('span');
        number.className = 'episode-number-pill';
        number.textContent = `EP ${episode.episodeNumber}`;
        top.appendChild(number);
      }

      const meta = document.createElement('div');
      meta.className = 'episode-card-meta';

      const dateLabel = formatDate(episode.publishedAtIso || episode.publishedAt);
      if (dateLabel) {
        const date = document.createElement('span');
        date.textContent = dateLabel;
        meta.appendChild(date);
      }

      if (episode.duration) {
        const duration = document.createElement('span');
        duration.textContent = episode.duration;
        meta.appendChild(duration);
      }

      if (meta.childNodes.length) top.appendChild(meta);

      const title = document.createElement('h3');
      title.className = 'episode-card-title';
      title.textContent = episode.title || 'Episode title';

      const summary = document.createElement('p');
      summary.className = 'episode-card-summary';
      summary.textContent = episode.summary || 'Listen to the full episode for the complete conversation.';

      const actions = document.createElement('div');
      actions.className = 'episode-card-actions';

      const primaryAction = document.createElement('a');
      primaryAction.className = 'btn btn-primary btn-sm';
      primaryAction.href = episode.audioUrl || episode.link || '#';
      primaryAction.textContent = episode.audioUrl ? 'Listen now' : 'Open episode';
      if (primaryAction.href !== '#') {
        primaryAction.target = '_blank';
        primaryAction.rel = 'noopener noreferrer';
      }
      actions.appendChild(primaryAction);

      if (episode.link && episode.audioUrl && episode.link !== episode.audioUrl) {
        const secondaryAction = document.createElement('a');
        secondaryAction.className = 'btn btn-secondary btn-sm';
        secondaryAction.href = episode.link;
        secondaryAction.target = '_blank';
        secondaryAction.rel = 'noopener noreferrer';
        secondaryAction.textContent = 'Show notes';
        actions.appendChild(secondaryAction);
      }

      article.append(top, title, summary, actions);
      episodeList.appendChild(article);
    });
  }

  function formatDate(value) {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';

    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(parsed);
  }
})();

let currentPage = 1;
let selectedTimezone = 'default';
let actionSuggestions = [];
let actionSearchTimeout = null;

// DOM Elements
const searchForm = document.getElementById('searchForm');
const logsTableBody = document.getElementById('logsTableBody');
const prevPageBtn = document.getElementById('prevPage');
const nextPageBtn = document.getElementById('nextPage');
const currentPageSpan = document.getElementById('currentPage');
const refreshButton = document.getElementById('refreshButton');
const timezoneSelect = document.getElementById('timezone');
const queryTimeSpan = document.getElementById('queryTime');

// Event Listeners
searchForm.addEventListener('submit', handleSearch);
refreshButton.addEventListener('click', refreshLogs);
prevPageBtn.addEventListener('click', () => changePage(-1));
nextPageBtn.addEventListener('click', () => changePage(1));

// Update timezone change handler
document.getElementById('timezone').addEventListener('change', function(e) {
    selectedTimezone = e.target.value;
    // Store the preference
    localStorage.setItem('preferredTimezone', selectedTimezone);
    // Refresh the display
    refreshLogs();
});

// Action search functionality
document.getElementById('action').addEventListener('input', function(e) {
    clearTimeout(actionSearchTimeout);
    const search = e.target.value.trim();
    
    actionSearchTimeout = setTimeout(async () => {
        try {
            const response = await fetch(`/api/actions?search=${encodeURIComponent(search)}`);
            if (!response.ok) throw new Error('Failed to fetch actions');
            
            const data = await response.json();
            actionSuggestions = data;
            showActionSuggestions();
        } catch (error) {
            console.error('Error fetching actions:', error);
        }
    }, 300);
});

document.getElementById('action').addEventListener('focus', function(e) {
    const search = e.target.value.trim();
    if (search.length > 0) {
        showActionSuggestions();
    }
});

// Close suggestions when clicking outside
document.addEventListener('click', function(e) {
    if (!e.target.closest('#action') && !e.target.closest('#action-suggestions')) {
        hideActionSuggestions();
    }
});

function showActionSuggestions() {
    const actionInput = document.getElementById('action');
    let suggestionsDiv = document.getElementById('action-suggestions');
    
    if (!suggestionsDiv) {
        suggestionsDiv = document.createElement('div');
        suggestionsDiv.id = 'action-suggestions';
        suggestionsDiv.className = 'action-suggestions absolute w-full bg-gray-700 mt-1 rounded-md shadow-lg z-50 max-h-48 overflow-y-auto';
        actionInput.parentNode.appendChild(suggestionsDiv);
    }
    
    if (actionSuggestions.length > 0) {
        suggestionsDiv.innerHTML = '';
        actionSuggestions.forEach(action => {
            const div = document.createElement('div');
            div.className = 'action-suggestion p-2 hover:bg-gray-600 cursor-pointer';
            div.innerHTML = `${action.action}<span class="text-gray-400 text-sm ml-1">(${action.count})</span>`;
            div.addEventListener('click', function() {
                actionInput.value = action.action;
                hideActionSuggestions();
                handleSearch(new Event('submit'));
            });
            suggestionsDiv.appendChild(div);
        });
        suggestionsDiv.style.display = 'block';
    } else {
        suggestionsDiv.style.display = 'none';
    }
}

function hideActionSuggestions() {
    const suggestionsDiv = document.getElementById('action-suggestions');
    if (suggestionsDiv) {
        suggestionsDiv.style.display = 'none';
    }
}

// Constants for action types
const DISCONNECT_ACTIONS = [
    'User Disconnected',
    'Character Unloaded',
    'Unloaded Character',
    'Dropped Timed Out Player',
    'Disconnected',  // Adding common variations
    'Disconnect',
    'Unload'
];

const CONNECT_ACTIONS = [
    'User Joined',
    'User Connected',
    'Character Loaded',
    'Connection Accepted',
    'Connected',     // Adding common variations
    'Connect',
    'Join',
    'Load'
];

const MONEY_TRANSFER_ACTIONS = [
    'Bank Transfer',
    'Cash Transfer',
    'Paid Bill'
];

const DRUG_LOGS = [
    "Gun Run",
    "Gun Run Drop",
    "Cocaine Run",
    "Oxy Run Started",
    "Oxy Run Ended",
    "Oxy Run Failed",
    "Jim's Gun Shop",
    "Crafted Gun"
];

// Quick filter buttons
document.getElementById('drugLogsBtn').addEventListener('click', function() {
    const actionInput = document.getElementById('action');
    actionInput.value = DRUG_LOGS.map(action => `=${action}`).join('|');
    handleSearch(new Event('submit'));
});

document.getElementById('moneyLogsBtn').addEventListener('click', function() {
    const actionInput = document.getElementById('action');
    actionInput.value = MONEY_TRANSFER_ACTIONS.map(action => `=${action}`).join('|');
    handleSearch(new Event('submit'));
});

document.getElementById('connectLogsBtn').addEventListener('click', function() {
    const actionInput = document.getElementById('action');
    const allConnectionActions = [...CONNECT_ACTIONS, ...DISCONNECT_ACTIONS];
    actionInput.value = allConnectionActions.map(action => `=${action}`).join('|');
    handleSearch(new Event('submit'));
});

// Prevent form submission on Enter key in action input
document.getElementById('action').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        handleSearch(new Event('submit'));
    }
});

// Functions
async function fetchLogs(params = {}) {
    const queryParams = new URLSearchParams();
    
    // Add page parameter
    queryParams.append('page', currentPage);

    // Add filters
    const filters = {
        identifier: document.getElementById('identifier').value.trim(),
        action: document.getElementById('action').value.trim(),
        details: document.getElementById('details').value.trim(),
        server: document.getElementById('server').value.trim(),
        minigames: document.getElementById('minigames').value,
        before: document.getElementById('before').value ? Math.floor(new Date(document.getElementById('before').value).getTime() / 1000) : '',
        after: document.getElementById('after').value ? Math.floor(new Date(document.getElementById('after').value).getTime() / 1000) : ''
    };

    // Add non-empty filters to query params
    Object.entries(filters).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) {
            queryParams.append(key, value);
        }
    });

    try {
        const response = await fetch(`/api/logs?${queryParams}`);
        if (!response.ok) throw new Error('Failed to fetch logs');
        const data = await response.json();
        return data;
    } catch (error) {
        console.error('Error fetching logs:', error);
        return { logs: [], page: 1 };
    }
}

function formatTimestamp(timestamp) {
    if (!timestamp) return '-';
    
    const date = new Date(timestamp);
    let formatted;
    let timezone;
    
    if (selectedTimezone === 'default') {
        formatted = moment(date).format('MMM DD, YYYY HH:mm:ss');
        timezone = moment().format('z');
    } else {
        formatted = moment(date).tz(selectedTimezone).format('MMM DD, YYYY HH:mm:ss');
        timezone = moment().tz(selectedTimezone).format('z');
    }
    
    const epoch = Math.floor(date.getTime() / 1000);
    
    return `<div class="flex flex-col">
        <div class="text-white">${formatted}</div>
        <div class="flex items-center gap-1 text-[11px]">
            <span class="text-yellow-400">${epoch}</span>
            <span class="text-gray-500">-</span>
            <span class="text-gray-500">${timezone}</span>
        </div>
    </div>`;
}

function formatLicense(text) {
    if (!text) return text;
    
    // Handle both license: format and direct hex format
    return text.replace(/(?:license:)?([a-f0-9]{32,})/gi, (match, license) => {
        const fullLicense = match.startsWith('license:') ? match : `license:${license}`;
        const truncated = `${license.slice(0, 4)}...${license.slice(-4)}`;
        return `<span class="license-text" title="Click to copy full license" data-license="${fullLicense}">${truncated}</span>`;
    });
}

function highlightBackticks(text) {
    if (!text) return text;
    return text.replace(/`([^`]+)`/g, '<span class="backtick-highlight">$1</span>');
}

function getLogTag(action, metadata) {
    const minigames = metadata?.minigames || [];

    if (minigames.length > 0) {
        return `<i class="text-purple-800 fas fa-gamepad" title="${minigames.join(', ')}"></i>`;
    } else if (MONEY_TRANSFER_ACTIONS.includes(action)) {
        return `<i class="text-teal-800 fas fa-money-bill-wave" title="money transfer"></i>`;
    } else if (DRUG_LOGS.includes(action)) {
        return `<i class="text-yellow-800 fas fa-tablets" title="drugs"></i>`;
    } else if (DISCONNECT_ACTIONS.includes(action)) {
        return `<i class="text-rose-800 fas fa-door-open" title="exit/disconnect/unload"></i>`;
    } else if (CONNECT_ACTIONS.includes(action)) {
        return `<i class="text-lime-800 fas fa-person-booth" title="connect/join/load"></i>`;
    }

    return '';
}

function getLogColor(action, metadata) {
    const minigames = metadata?.minigames || [];
    
    if (CONNECT_ACTIONS.includes(action)) {
        return 'bg-green-500 bg-opacity-10';
    } 
    if (DISCONNECT_ACTIONS.includes(action)) {
        return 'bg-red-500 bg-opacity-10';
    }
    if (minigames.length > 0) {
        return 'bg-purple-500 bg-opacity-10';
    } 
    if (MONEY_TRANSFER_ACTIONS.includes(action)) {
        return 'bg-teal-500 bg-opacity-10';
    } 
    if (DRUG_LOGS.includes(action)) {
        return 'bg-yellow-500 bg-opacity-10';
    }

    return '';
}

function getPlayerName(details) {
    if (!details) return null;
    
    // Try to extract name from the format: "playername [serverid] (license:...)"
    const match = details.match(/^([^\[]+)/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return null;
}

function renderLogs(logs) {
    logsTableBody.innerHTML = '';
    
    logs.forEach(log => {
        const row = document.createElement('tr');
        const metadata = typeof log.metadata === 'string' ? JSON.parse(log.metadata) : log.metadata;
        const colorClass = getLogColor(log.action, metadata);
        
        row.className = `border-t border-gray-700 relative ${colorClass}`;
        
        const playerName = getPlayerName(log.details);
        const licenseMatch = log.details.match(/(license:[a-f0-9]{32,})/);
        const license = licenseMatch ? licenseMatch[0] : null;
        const formattedDetails = highlightBackticks(formatLicense(log.details));
        const logTag = getLogTag(log.action, metadata);
        
        row.innerHTML = `
            <td class="p-2 pl-8">
                <div class="absolute top-2 left-2 text-sm leading-3 font-semibold italic">${logTag}</div>
                <div class="player-box">
                    ${playerName && license ? 
                        `<div class="px-2 py-1 text-xs font-medium text-center text-white bg-indigo-600 hover:bg-indigo-700 rounded truncate cursor-pointer player-link" data-license="${license}">
                            ${playerName}
                        </div>` : 
                        `<div class="px-2 py-1 text-xs font-medium text-center text-white bg-teal-600 hover:bg-teal-700 rounded truncate">
                            System
                        </div>`
                    }
                </div>
            </td>
            <td class="p-2 text-xs text-white">${metadata?.playerServerId || '-'}</td>
            <td class="p-2 text-xs text-white">
                ${log.action || '-'}
                ${metadata ? `<i class="fas fa-info-circle ml-1 text-indigo-400 hover:text-indigo-300 cursor-pointer metadata-btn" data-metadata='${JSON.stringify(metadata)}'></i>` : ''}
            </td>
            <td class="p-2 text-xs text-white">${formattedDetails || '-'}</td>
            <td class="p-2 text-xs text-white">${formatTimestamp(log.timestamp)}</td>
        `;

        // Add event listeners after creating the row
        const metadataBtn = row.querySelector('.metadata-btn');
        if (metadataBtn) {
            metadataBtn.addEventListener('click', function() {
                const metadata = JSON.parse(this.dataset.metadata);
                showMetadata(metadata);
            });
        }

        // Add click handler for player name link
        const playerLink = row.querySelector('.player-link');
        if (playerLink && playerLink.dataset.license) {
            playerLink.addEventListener('click', function() {
                const license = this.dataset.license;
                if (license) {
                    window.open(`https://c8.lrp.ovh/players/${license}`, '_blank');
                }
            });
        }
        
        logsTableBody.appendChild(row);
    });

    // Add click handlers for license copying
    document.querySelectorAll('.license-text').forEach(el => {
        el.addEventListener('click', function() {
            const license = this.dataset.license;
            navigator.clipboard.writeText(license).then(() => {
                const originalText = this.textContent;
                this.textContent = 'Copied!';
                setTimeout(() => {
                    this.textContent = originalText;
                }, 1000);
            });
        });
    });
}

function showMetadata(metadata) {
    const modal = document.createElement('div');
    modal.className = 'metadata-modal';
    modal.innerHTML = `
        <div class="metadata-content">
            <div class="metadata-header">
                <h2 class="text-white text-lg font-medium">Metadata</h2>
                <button class="text-gray-400 hover:text-white close-metadata">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="metadata-items">
                ${Object.entries(metadata).map(([key, value]) => `
                    <div class="metadata-item">
                        <i class="fas fa-copy metadata-copy" data-value='${JSON.stringify(value)}'></i>
                        <div class="metadata-key">
                            <i class="fas fa-caret-right"></i>
                            ${key}
                        </div>
                        <pre class="metadata-value">${JSON.stringify(value, null, 2)}</pre>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    setTimeout(() => modal.classList.add('show'), 0);

    // Add click handlers for close button
    modal.querySelector('.close-metadata').addEventListener('click', function() {
        this.closest('.metadata-modal').remove();
    });

    // Add click handlers for copy buttons
    modal.querySelectorAll('.metadata-copy').forEach(btn => {
        btn.addEventListener('click', function() {
            const value = this.dataset.value;
            navigator.clipboard.writeText(value);
        });
    });

    // Add click handlers for metadata items
    modal.querySelectorAll('.metadata-key').forEach(key => {
        const value = key.nextElementSibling;
        const caret = key.querySelector('.fas');
        key.addEventListener('click', () => {
            value.style.display = value.style.display === 'none' ? 'block' : 'none';
            caret.classList.toggle('fa-caret-right');
            caret.classList.toggle('fa-caret-down');
        });
        // Initially hide the values
        value.style.display = 'none';
    });
}

async function handleSearch(e) {
    e.preventDefault();
    currentPage = 1;
    await refreshLogs();
}

async function refreshLogs() {
    const formData = new FormData(searchForm);
    const params = Object.fromEntries(formData.entries());
    
    // Convert datetime-local to timestamps
    if (params.after) {
        params.after = Math.floor(new Date(params.after).getTime() / 1000);
    }
    if (params.before) {
        params.before = Math.floor(new Date(params.before).getTime() / 1000);
    }
    
    const data = await fetchLogs(params);
    renderLogs(data.logs);
    currentPageSpan.textContent = `Page ${currentPage}`;
    
    // Display query time from server
    if (data.queryTime !== undefined) {
        queryTimeSpan.textContent = `Query took ${data.queryTime}ms`;
    }
}

async function changePage(delta) {
    const newPage = currentPage + delta;
    if (newPage < 1) return;
    
    // Hide previous button on page 1
    const prevButton = document.getElementById('prevPage');
    if (prevButton) {
        prevButton.style.visibility = newPage === 1 ? 'hidden' : 'visible';
    }
    
    currentPage = newPage;
    await refreshLogs();
}

// Load preferred timezone on startup
document.addEventListener('DOMContentLoaded', () => {
    const savedTimezone = localStorage.getItem('preferredTimezone');
    if (savedTimezone) {
        selectedTimezone = savedTimezone;
        const timezoneSelect = document.getElementById('timezone');
        timezoneSelect.value = savedTimezone;
    }
    refreshLogs();
    // Hide previous button initially
    const prevButton = document.getElementById('prevPage');
    if (prevButton) {
        prevButton.style.visibility = 'hidden';
    }
});

document.getElementById('minigames').addEventListener('change', function() {
    currentPage = 1;
    refreshLogs();
});

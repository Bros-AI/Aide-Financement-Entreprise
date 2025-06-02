// Global chart instances
let domainChart, sizeChart, regionChart, ageChart;
const CONFIG = { CHUNK_SIZE: 1000, ITEM_HEIGHT: 320 };

function fixFrenchAccents(str) {
  if (!str) return '';
  return str.replace(/�/g, 'é');
}

// UPDATED DATA LOADING STRATEGY: Manual Fetch for local CSV, then PapaParse
async function loadDataFromURLManualFetch(url) {
  const fundingGrid = document.getElementById('funding-grid');
  fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem;">INITIATING LOCAL FILE FETCH PROTOCOL FROM: ${url}... PREPARING FOR GLORY.</div>`;
  console.log(`Attempting to fetch local file: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      // mode: 'cors', // mode: 'cors' is generally for cross-origin. For same-origin (local server) or file:///, default is fine.
                     // If running on a local server, this request will be same-origin.
                     // If running directly via file:///, browser security might block fetch. Always use a local server for development.
    });

    console.log("Fetch response received. Status:", response.status, "OK:", response.ok);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => "Could not read error response body.");
      throw new Error(`HTTP error! Status: ${response.status}. URL: ${url}. Body: ${errorText.substring(0, 200)}. Ensure 'aides.csv' is in the project root and the dev server is running.`);
    }

    console.log("Response Headers:");
    response.headers.forEach((value, name) => {
      console.log(`  ${name}: ${value}`);
    });
    
    const contentType = response.headers.get("content-type");
    console.log("Content-Type:", contentType);
    if (!contentType || (!contentType.includes("csv") && !contentType.includes("text/plain") && !contentType.includes("application/octet-stream"))) {
        console.warn("WARNING: Content-Type from server for local CSV is not explicitly CSV. It is:", contentType, ". Proceeding with PapaParse, fingers crossed.");
    }

    const blob = await response.blob();
    
    // Using TextDecoder for reliable ISO-8859-1 decoding
    const textDecoder = new TextDecoder('ISO-8859-1');
    const fileAsText = await blob.text(); // Using blob.text() can guess encoding, TextDecoder is more explicit
                                          // Let's stick to the explicit TextDecoder approach previously decided as more reliable
    const decodedText = textDecoder.decode(await blob.arrayBuffer()); // Read blob as ArrayBuffer first for TextDecoder

    console.log("Data fetched and decoded via TextDecoder. Length:", decodedText.length, "Parsing with PapaParse...");
    
    let processedData = [];
    Papa.parse(decodedText, { 
        header: true, 
        skipEmptyLines: true, 
        delimiter: ';',
        chunkSize: CONFIG.CHUNK_SIZE,
        chunk: function(results) {
            const cleanedChunk = results.data.map(row => {
                const cleanedRow = {};
                for (const key in row) { cleanedRow[key] = fixFrenchAccents(row[key]); }
                return cleanedRow;
            });
            processedData = processedData.concat(cleanedChunk);
        },
        complete: function() {
            console.log("PapaParse (from local fetch & TextDecoder) COMPLETE. Rows:", processedData.length);
            if (processedData.length === 0) {
              console.warn("WARNING: No data parsed from local file or the file is empty. THIS IS SUBOPTIMAL.");
              fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:var(--gray);">MISSION FAILED: Aucune donnée exploitée depuis le fichier local '${url}'. Vérifiez le fichier et la console.</div>`;
              window.currentAides = [];
              updateStatistics([]); createCharts([]); displayAidCards([]); initSearchAndFilters([]);
              return;
            }
            window.currentAides = processedData;
            updateStatistics(processedData); createCharts(processedData);
            displayAidCards(processedData); initSearchAndFilters(processedData);
            document.getElementById('funding-list').scrollIntoView({ behavior: 'smooth' });
        },
        error: function(papaparseError) {
            console.error("!!!PAPA PARSE FAILURE (POST-LOCAL FETCH)!!! DETAILS:", papaparseError);
            fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">SYSTEM ERROR: Échec du parsing CSV du fichier local. <br>Diagnosis: ${papaparseError.message || 'Unknown PapaParse error'}. Check console.</div>`;
        }
    });

  } catch (error) {
    console.error("!!!LOCAL FETCH CRITICAL FAILURE!!! DETAILS:", error);
    let reason = error.message || "Unknown fetch error. This is not the heroic outcome we wanted.";
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        reason += " This often indicates the file path is incorrect, the file is not accessible, or you're running `index.html` directly via `file:///` (use a local HTTP server like VS Code's Live Server).";
    }
    fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">SYSTEM ERROR: Échec du chargement du fichier local '${url}'. <br>Diagnosis: ${reason}. <br>CHECK CONSOLE. ENSURE '${url}' EXISTS AND SERVER IS RUNNING.</div>`;
  }
}


function updateStatistics(aides) {
  document.getElementById('stat-total').textContent = aides.length;
  const aidesNationales = aides.filter(aide => aide.couverture_geo === 'aide nationale');
  document.getElementById('stat-national').textContent = aidesNationales.length;
  const aidesTerritoriales = aides.filter(aide => aide.couverture_geo === 'aide territoriale');
  document.getElementById('stat-territorial').textContent = aidesTerritoriales.length;
  
  let totalAmount = 0;
  let countWithAmount = 0;
  if (aides && aides.length > 0) {
    aides.forEach(aide => {
        const montantText = aide.aid_montant || '';
        const montantMatch = montantText.match(/\d[\d\s]*\d+/); 
        if (montantMatch) {
        const montant = parseInt(montantMatch[0].replace(/\s/g, ''));
        if (!isNaN(montant)) {
            totalAmount += montant;
            countWithAmount++;
        }
        }
    });
  }
  
  const avgAmount = countWithAmount > 0 ? Math.round(totalAmount / countWithAmount) : 0;
  document.getElementById('stat-montant').textContent = new Intl.NumberFormat('fr-FR').format(avgAmount) + " €";
}

function createCharts(aides) {
  aides = aides || []; 

  const pieTooltipCallback = {
    callbacks: {
        label: function(context) {
            const label = context.label || '';
            const value = context.raw;
            const total = context.chart.getDatasetMeta(0).total; 
            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
            return `${label}: ${value} (${percentage}%)`;
        }
    }
  };

  // 1. Domain Chart
  const domainCounts = {};
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (aide.id_domaine) {
        const splitted = aide.id_domaine.split(',').map(s => s.trim());
        splitted.forEach(dom => {
            if (dom) { domainCounts[dom] = (domainCounts[dom] || 0) + 1; }
        });
        }
    });
  }
  
  const sortedDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8); 
  
  const domainCtx = document.getElementById('domain-chart').getContext('2d');
  if (domainChart) { domainChart.destroy(); } 
  domainChart = new Chart(domainCtx, {
    type: 'pie',
    data: {
      labels: sortedDomains.length > 0 ? sortedDomains.map(d => d[0]) : ['Aucune donnée'],
      datasets: [{
        data: sortedDomains.length > 0 ? sortedDomains.map(d => d[1]) : [1],
        backgroundColor: sortedDomains.length > 0 ? ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#10b981', '#34d399', '#1e3a8a'] : ['#cccccc']
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { 
        legend: { position: 'bottom', display: sortedDomains.length > 0 },
        tooltip: { ...pieTooltipCallback, enabled: sortedDomains.length > 0 }
      } 
    }
  });

  // 2. Size Chart
  const sizeCounts = { 'Moins de 10': 0, '10-49': 0, '50-249': 0, '250 et plus': 0, 'Toutes tailles': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        let found = false;
        const effectifStr = (aide.effectif || '').toLowerCase();
        if (effectifStr) {
            if (effectifStr.includes('-10') || effectifStr.includes('-5')) { sizeCounts['Moins de 10']++; found = true; }
            else if (effectifStr.includes('10-49')) { sizeCounts['10-49']++; found = true; }
            else if (effectifStr.includes('50-249')) { sizeCounts['50-249']++; found = true; }
            else if (effectifStr.includes('250 et plus')) { sizeCounts['250 et plus']++; found = true; }
            else if (effectifStr.includes('tous') || effectifStr.includes('all')) { sizeCounts['Toutes tailles']++; found = true; }
        }
        if (!found) sizeCounts['Non spécifié']++;
    });
  }
  
  const sizeCtx = document.getElementById('size-chart').getContext('2d');
  if (sizeChart) { sizeChart.destroy(); }
  sizeChart = new Chart(sizeCtx, {
    type: 'bar',
    data: {
      labels: Object.keys(sizeCounts),
      datasets: [{
        label: "Nombre d'aides",
        data: Object.values(sizeCounts),
        backgroundColor: '#1e40af'
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { legend: { display: false } }, 
      scales: { y: { beginAtZero: true, suggestedMax: aides.length > 0 ? undefined : 10 } } 
    }
  });
  
  // 3. Region Chart
  const regionCounts = { 'Nationale': 0, 'Territoriale': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (aide.couverture_geo === 'aide nationale') regionCounts['Nationale']++;
        else if (aide.couverture_geo === 'aide territoriale') regionCounts['Territoriale']++;
        else regionCounts['Non spécifié']++;
    });
  }
  
  const regionCtx = document.getElementById('region-chart').getContext('2d');
  if (regionChart) { regionChart.destroy(); }
  regionChart = new Chart(regionCtx, {
    type: 'doughnut',
    data: {
      labels: aides.length > 0 ? Object.keys(regionCounts) : ['Aucune donnée'],
      datasets: [{
        data: aides.length > 0 ? Object.values(regionCounts) : [1],
        backgroundColor: aides.length > 0 ? ['#1e40af', '#10b981', '#64748b'] : ['#cccccc']
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { 
        legend: { position: 'bottom', display: aides.length > 0},
        tooltip: { ...pieTooltipCallback, enabled: aides.length > 0 }
      } 
    }
  });
  
  // 4. Age Chart
  const ageCounts = { 'Moins de 3 ans': 0, 'Plus de 3 ans': 0, 'Tout âge': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (!aide.age_entreprise) ageCounts['Non spécifié']++;
        else if (aide.age_entreprise.includes('- de 3 ans')) ageCounts['Moins de 3 ans']++;
        else if (aide.age_entreprise.includes('+ de 3 ans')) ageCounts['Plus de 3 ans']++;
        else ageCounts['Tout âge']++; 
    });
  }
  
  const ageCtx = document.getElementById('age-chart').getContext('2d');
  if (ageChart) { ageChart.destroy(); }
  ageChart = new Chart(ageCtx, {
    type: 'bar',
    data: {
      labels: Object.keys(ageCounts),
      datasets: [{
        label: "Nombre d'aides",
        data: Object.values(ageCounts),
        backgroundColor: '#f59e0b' 
      }]
    },
    options: { 
      responsive: true, 
      maintainAspectRatio: false, 
      plugins: { legend: { display: false } }, 
      scales: { y: { beginAtZero: true, suggestedMax: aides.length > 0 ? undefined : 10 } } 
    }
  });
}

function displayAidCards(aides, page = 1) {
  const gridContainer = document.getElementById('funding-grid');
  gridContainer.innerHTML = ""; 
  const itemsPerPage = 6; 
  const startIndex = (page - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, (aides || []).length);
  const displayedAides = (aides || []).slice(startIndex, endIndex);
  
  if (!aides || aides.length === 0) {
    gridContainer.innerHTML = '<div class="no-results" style="text-align:center; padding:2rem; color:var(--gray);">ZERO. NADA. RIEN. Aucune aide trouvée.</div>';
    document.getElementById('pagination').innerHTML = ''; 
    return;
  }
  
  displayedAides.forEach(aide => {
    const card = document.createElement('div');
    card.className = 'funding-card';
    card.dataset.id = aide.id_aid; 
    
    const effectifs = (aide.effectif || 'Non spécifié')
      .split(',')
      .map(eff => eff.trim())
      .map(eff => {
        if (eff === '-10') return 'Moins de 10 salariés';
        if (eff === '-5') return 'Moins de 5 salariés'; 
        return eff;
      })
      .join(', ');
      
    const ageEntreprise = aide.age_entreprise || 'Non spécifié';
    const categories = (aide.id_domaine || 'Non spécifié').split(',').map(cat => cat.trim()).join(', ');
    
    card.innerHTML = `
      <div class="funding-card-header">
        <h3 class="funding-card-title">${aide.aid_nom || 'Sans titre'}</h3>
        <div class="funding-card-subtitle">${aide.couverture_geo || 'Non spécifié'} - ${categories}</div>
      </div>
      <div class="funding-card-body">
        <div class="funding-info-item">
          <div class="funding-info-label">Objectif</div>
          <div class="funding-info-value">${aide.aid_objet ? truncateText(aide.aid_objet, 150) : 'Non spécifié'}</div>
        </div>
        <div class="funding-info-item">
          <div class="funding-info-label">Bénéficiaires</div>
          <div class="funding-info-value">${aide.aid_benef ? truncateText(aide.aid_benef, 100) : 'Non spécifié'}</div>
        </div>
      </div>
      <div class="funding-card-footer">
        <div class="funding-tags">
          <div class="funding-tag">${effectifs}</div>
          <div class="funding-tag">${ageEntreprise}</div>
        </div>
        <button class="cta-button secondary view-details" data-id="${aide.id_aid}">Voir les détails</button>
      </div>
    `;
    gridContainer.appendChild(card);
  });
  
  document.querySelectorAll('.view-details').forEach(button => {
    button.addEventListener('click', function() { 
      const aideId = this.getAttribute('data-id');
      const sourceAides = window.currentAides || [];
      const aide = sourceAides.find(a => a.id_aid === aideId);
      if (aide) { showAideDetails(aide); }
      else { console.error("Aide non trouvée pour ID:", aideId, "Source:", sourceAides); } 
    });
  });
  
  createPagination((aides || []).length, itemsPerPage, page);
}

function truncateText(text, maxLength) {
  if (!text) return ''; 
  return text.length <= maxLength ? text : text.substring(0, maxLength) + '...'; 
}

function createPagination(totalItems, itemsPerPage, currentPage) {
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const paginationContainer = document.getElementById('pagination');
  paginationContainer.innerHTML = "";
  
  if (totalPages <= 1) return; 
  
  const prevButton = document.createElement('button');
  prevButton.className = 'pagination-button';
  prevButton.innerHTML = '«'; 
  prevButton.disabled = currentPage === 1;
  prevButton.addEventListener('click', () => {
    if (currentPage > 1) {
      const filteredAides = getFilteredAides(window.currentAides || []); 
      displayAidCards(filteredAides, currentPage - 1);
    }
  });
  paginationContainer.appendChild(prevButton);
  
  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);
  
  if (endPage - startPage + 1 < maxVisiblePages && totalPages >= maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  } else if (totalPages < maxVisiblePages) {
    startPage = 1;
    endPage = totalPages;
  }
  
  for (let i = startPage; i <= endPage; i++) {
    const pageButton = document.createElement('button');
    pageButton.className = 'pagination-button';
    if (i === currentPage) pageButton.classList.add('active');
    pageButton.textContent = i;
    pageButton.addEventListener('click', () => {
      const filteredAides = getFilteredAides(window.currentAides || []);
      displayAidCards(filteredAides, i);
    });
    paginationContainer.appendChild(pageButton);
  }
  
  const nextButton = document.createElement('button');
  nextButton.className = 'pagination-button';
  nextButton.innerHTML = '»';
  nextButton.disabled = currentPage === totalPages;
  nextButton.addEventListener('click', () => {
    if (currentPage < totalPages) {
      const filteredAides = getFilteredAides(window.currentAides || []);
      displayAidCards(filteredAides, currentPage + 1);
    }
  });
  paginationContainer.appendChild(nextButton);
}

function initSearchAndFilters(aides) {
  aides = aides || []; 
  
  document.getElementById('search-form').addEventListener('submit', function(e) {
    e.preventDefault(); 
    const searchTerm = document.getElementById('search-input').value.toLowerCase();
    const filteredAides = getFilteredAides(window.currentAides || [], searchTerm); 
    displayAidCards(filteredAides, 1); 
  });
  
  document.getElementById('apply-filters').addEventListener('click', function() {
    const filteredAides = getFilteredAides(window.currentAides || []); 
    displayAidCards(filteredAides, 1);
  });
  
  document.getElementById('reset-filters').addEventListener('click', function() {
    document.getElementById('search-input').value = '';
    document.getElementById('category').value = '';
    document.getElementById('company-size').value = '';
    document.getElementById('company-age').value = '';
    document.getElementById('geography').value = '';
    displayAidCards(window.currentAides || [], 1); 
  });
  
  const categorySelect = document.getElementById('category');
  const categories = new Set();
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (aide.id_domaine) {
        const cats = aide.id_domaine.split(',').map(cat => cat.trim());
        cats.forEach(cat => {
            if (cat) categories.add(cat);
        });
        }
    });
  }
  const sortedCategories = Array.from(categories).sort(); 
  
  while (categorySelect.options.length > 1) {
    categorySelect.remove(1);
  }
  sortedCategories.forEach(cat => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat;
    categorySelect.appendChild(option);
  });
}

function getFilteredAides(allAides, searchTerm = null) {
  allAides = allAides || []; 
  if (!Array.isArray(allAides)) {
    console.error("INVALID AIDES ARRAY. THIS IS A BUG.", allAides);
    return []; 
  }
  
  const currentSearchTerm = searchTerm !== null ? searchTerm : document.getElementById('search-input').value.toLowerCase();
  const category = document.getElementById('category').value;
  const companySize = document.getElementById('company-size').value;
  const companyAge = document.getElementById('company-age').value;
  const geography = document.getElementById('geography').value;
  
  return allAides.filter(aide => {
    if (currentSearchTerm) {
      const inName = aide.aid_nom && aide.aid_nom.toLowerCase().includes(currentSearchTerm);
      const inObjet = aide.aid_objet && aide.aid_objet.toLowerCase().includes(currentSearchTerm);
      const inBenef = aide.aid_benef && aide.aid_benef.toLowerCase().includes(currentSearchTerm);
      const inDomaine = aide.id_domaine && aide.id_domaine.toLowerCase().includes(currentSearchTerm);
      if (!inName && !inObjet && !inBenef && !inDomaine) return false;
    }
    
    if (category) {
      if (!aide.id_domaine || !aide.id_domaine.split(',').map(cat => cat.trim()).includes(category)) return false;
    }
    
    if (companySize) { 
        const aideEffectif = (aide.effectif || '').toLowerCase();
        let sizeMatch = false;
        switch(companySize) {
            case "-10": sizeMatch = aideEffectif.includes('-10') || aideEffectif.includes('-5'); break;
            case "10-49": sizeMatch = aideEffectif.includes('10-49'); break;
            case "50-249": sizeMatch = aideEffectif.includes('50-249'); break;
            case "250 et plus": sizeMatch = aideEffectif.includes('250 et plus'); break;
            default: if (companySize) sizeMatch = aideEffectif.includes(companySize); else sizeMatch = true; 
        }
        if (!sizeMatch) return false;
    }
    
    if (companyAge && !(aide.age_entreprise || '').includes(companyAge)) return false;
    if (geography && aide.couverture_geo !== geography) return false;
    
    return true; 
  });
}

function showAideDetails(aide) {
  const modal = document.getElementById('detail-modal');
  document.getElementById('modal-title').textContent = aide.aid_nom || 'Sans titre';
  const categories = (aide.id_domaine || 'Non spécifié').split(',').map(cat => cat.trim()).join(', ');
  document.getElementById('modal-subtitle').textContent = `${aide.couverture_geo || 'Non spécifié'} - ${categories}`;
  
  let bodyContent = "";
  const addSection = (title, content) => {
    if (content) {
      bodyContent += `
        <div class="modal-section">
          <h3 class="modal-section-title">${title}</h3>
          <div class="modal-text">${content}</div>
        </div>`;
    }
  };

  addSection('Objectif', aide.aid_objet);
  addSection('Opérations éligibles', aide.aid_operations_el);
  addSection('Conditions', aide.aid_conditions);
  addSection('Montant', aide.aid_montant);
  addSection('Bénéficiaires', aide.aid_benef);

  let complementInfo = `<p><strong>Taille d'entreprise :</strong> ${aide.effectif || 'Non spécifié'}</p>
                        <p><strong>Âge d'entreprise :</strong> ${aide.age_entreprise || 'Non spécifié'}</p>
                        <p><strong>Date de fin :</strong> ${aide.aid_validation || 'Non spécifié'}</p>`;
  addSection('Informations complémentaires', complementInfo);
  
  let linksContent = "";
  if (aide.complements_sources) {
    linksContent += `<p><strong>Sources d'information :</strong> ${formatLinks(aide.complements_sources)}</p>`;
  }
  if (aide.complements_formulaires) {
    linksContent += `<p><strong>Formulaires de demande :</strong> ${formatLinks(aide.complements_formulaires)}</p>`;
  }
  if (linksContent) addSection('Liens utiles', linksContent);
  
  document.getElementById('modal-body').innerHTML = bodyContent;
  modal.classList.add('open'); 
}

function formatLinks(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s"<>]+)/g; 
  return text.replace(urlRegex, '<a href="$1" target="_blank" style="color:var(--primary); text-decoration:underline;">$1</a>');
}

function initModal() {
  const modal = document.getElementById('detail-modal');
  const closeBtn = document.getElementById('modal-close');
  const closeBtnFooter = document.getElementById('modal-close-btn');
  
  const closeModal = () => modal.classList.remove('open');
  
  closeBtn.addEventListener('click', closeModal);
  closeBtnFooter.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { 
    if (e.target === modal) closeModal(); 
  });
  document.querySelector('.modal-content').addEventListener('click', (e) => e.stopPropagation());
}

document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM LOADED. LOCAL CSV FILE PROTOCOL ENGAGED. SUCCESS IS THE ONLY OPTION.");
  initModal(); 
  
  // UPDATED to local file path
  const DATA_URL = "aides.csv"; 
  
  // Initialize UI elements with empty/default state
  updateStatistics([]);
  createCharts([]);
  displayAidCards([]); 
  initSearchAndFilters([]);

  // Load data from the local CSV
  loadDataFromURLManualFetch(DATA_URL); 
});

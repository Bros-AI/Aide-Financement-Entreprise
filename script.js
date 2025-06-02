// script.js
'use strict';

let domainChart, sizeChart, regionChart, ageChart;
const CONFIG = { CHUNK_SIZE: 2048, ITEM_HEIGHT: 320 }; // Moderate chunk size

function fixFrenchAccents(input) {
  // ... (keep this function as is from previous patch)
  if (typeof input !== 'string') {
    return input;
  }
  if (!input) {
    return '';
  }
  const replacementCharUnicode = '\uFFFD';
  const replacementCharRegex = /\uFFFD/g;
  if (input.indexOf(replacementCharUnicode) === -1) {
    return input;
  }
  try {
    return input.replace(replacementCharRegex, 'é');
  } catch (e) {
    console.error(`Error in fixFrenchAccents with input (first 100 chars): "${String(input).substring(0,100)}..."`, e);
    return input;
  }
}

async function loadDataFromURLManualFetch(url) {
  const fundingGrid = document.getElementById('funding-grid');
  fundingGrid.innerHTML = `<div class="loading" style="text-align: center; padding: 2rem;">...loading message...</div>`;
  console.log(`Attempting to fetch from: ${url}`);

  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
    });

    console.log("Fetch response. Status:", response.status, "OK:", response.ok);
    if (!response.ok) {
      // ... (error handling as before)
      let errorDetails = `HTTP error! Status: ${response.status}. URL: ${url}.`;
      try { const errorText = await response.text(); errorDetails += ` Response body (first 200 chars): ${errorText.substring(0, 200)}`; } catch (e) { /* Ignore */ }
      throw new Error(errorDetails);
    }

    const blob = await response.blob(); // Get the Blob directly
    console.log("Data fetched as Blob. Size:", blob.size, "Type:", blob.type);
    console.log("Passing Blob to PapaParse with encoding: 'ISO-8859-1'...");

    let processedData = [];
    let rowCounter = 0;
    let chunkCounter = 0;

    // START --- MODIFIED PAPAPARSE CALL ---
    Papa.parse(blob, { // Pass the Blob directly
        encoding: "ISO-8859-1", // Let PapaParse handle encoding from the Blob
        header: true,
        skipEmptyLines: true,
        delimiter: ';',
        chunkSize: CONFIG.CHUNK_SIZE, // Still useful for large files
        // beforeFirstChunk: function(chunkText) { // This might not work the same with Blob input
        //     chunkCounter++;
        //     console.log(`RAW CHUNK #${chunkCounter} (BEFORE PAPAPARSE, first 200 chars): \n"${chunkText.substring(0,200)}\n"`);
        //     return chunkText;
        // },
        // The 'chunk' callback in PapaParse receives parsed data, not raw text chunks when input is a File/Blob
        // So, direct logging of raw text chunks processed by PapaParse internally is harder here.
        // We rely on its internal chunking.
        worker: false, // Explicitly disable worker to see if it makes a difference with Blob input. Often default.
        chunk: function(results, parser) {
            chunkCounter++;
            // console.log(`Processing PapaParse-generated chunk #${chunkCounter}. Rows: ${results.data.length}.`);
            if (results.errors.length > 0) {
                console.warn("PapaParse errors in this chunk:", results.errors);
                results.errors.forEach(err => {
                  console.warn(`  Detail: Type: ${err.type}, Code: ${err.code}, Message: ${err.message}, Row: ${err.row}`);
                });
            }
            try {
              const cleanedChunk = results.data.map((row) => {
                  const cleanedRow = {};
                  for (const key in row) {
                      if (Object.prototype.hasOwnProperty.call(row, key)) {
                          cleanedRow[key] = fixFrenchAccents(row[key]);
                      }
                  }
                  return cleanedRow;
              });
              processedData = processedData.concat(cleanedChunk);
              rowCounter += results.data.length;
            } catch (e) {
              console.error("Error during POST-parsing chunk processing (map/fixFrenchAccents):", e);
              parser.abort();
              fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">ERREUR CRITIQUE (POST-PARSE). Vérifiez console.</div>`;
              throw e;
            }
        },
        complete: function() {
            console.log(`PapaParse COMPLETE. Total rows: ${processedData.length}. Papa-chunks: ${chunkCounter}.`);
            // ... (rest of complete function as before)
            window.currentAides = processedData;
            updateStatistics(processedData); createCharts(processedData); displayAidCards(processedData); initSearchAndFilters(processedData);
            console.log("Traitement des données et mise à jour UI terminés.");
        },
        error: function(papaparseError) {
            console.error("!!! ERREUR PAPAPARSE GLOBALE (BLOB INPUT) !!!", papaparseError);
            fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">ERREUR SYSTÈME (BLOB): Échec du parsing. <br>Diagnostic: ${papaparseError.message}. Vérifiez console.</div>`;
        }
    });
    // END --- MODIFIED PAPAPARSE CALL ---

  } catch (error) {
    console.error("!!! ERREUR CRITIQUE (FETCH OU SETUP PAPAPARSE) !!!", error);
    // ... (rest of catch block as before)
    let reason = error.message || "Erreur inconnue.";
    if (error.name === 'RangeError' && error.message.includes('Maximum call stack size exceeded')) {
        reason += ` ERREUR PAPAPARSE INTERNE. Le fichier CSV sur GitHub CONTIENT DES DONNÉES PROBLÉMATIQUES.
        CHUNK_SIZE actuel: ${CONFIG.CHUNK_SIZE}.`;
    }
    fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">ERREUR SYSTÈME: ${reason}. Vérifiez console.</div>`;
  }
}

// ... (rest of your script.js: updateStatistics, createCharts, displayAidCards, etc. remain unchanged)
// Make sure DOMContentLoaded and other functions are correctly placed as in previous versions.

function updateStatistics(aides) {
  if (!Array.isArray(aides)) aides = [];
  document.getElementById('stat-total').textContent = aides.length;
  const aidesNationales = aides.filter(aide => aide && aide.couverture_geo === 'aide nationale');
  document.getElementById('stat-national').textContent = aidesNationales.length;
  const aidesTerritoriales = aides.filter(aide => aide && aide.couverture_geo === 'aide territoriale');
  document.getElementById('stat-territorial').textContent = aidesTerritoriales.length;

  let totalAmount = 0;
  let countWithAmount = 0;
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (!aide || !aide.aid_montant) return;
        const montantText = String(aide.aid_montant);
        const montantMatch = montantText.match(/\d[\d\s]*\d*?/);
        if (montantMatch) {
          const montantCleaned = montantMatch[0].replace(/\s/g, '');
          const montant = parseInt(montantCleaned, 10);
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
  if (!Array.isArray(aides)) aides = [];

  const pieTooltipCallback = {
    callbacks: {
        label: function(context) {
            const label = context.label || '';
            const value = context.raw;
            if (typeof value !== 'number') return `${label}: N/A`;
            const total = context.chart.getDatasetMeta(0).total;
            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
            return `${label}: ${value} (${percentage}%)`;
        }
    }
  };

  const ensureChartContainer = (id, title, parentGrid) => {
    if (!document.getElementById(id) && parentGrid) {
        const cardId = `${id}-card`;
        if(!document.getElementById(cardId)){
            const chartCard = document.createElement('div');
            chartCard.className = 'chart-card';
            chartCard.id = cardId;
            chartCard.innerHTML = `
            <h3 class="chart-title">${title}</h3>
            <div class="chart-container">
                <canvas id="${id}"></canvas>
            </div>
            `;
            parentGrid.appendChild(chartCard);
        }
    }
    return document.getElementById(id)?.getContext('2d');
  };

  const chartsGrid = document.querySelector('.charts-grid');

  const domainCounts = {};
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (aide && aide.id_domaine && typeof aide.id_domaine === 'string') {
          const splitted = aide.id_domaine.split(',').map(s => s.trim());
          splitted.forEach(dom => {
              if (dom) { domainCounts[dom] = (domainCounts[dom] || 0) + 1; }
          });
        }
    });
  }
  const sortedDomains = Object.entries(domainCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const domainCtx = ensureChartContainer('domain-chart', 'Répartition par domaine', chartsGrid);
  if (domainCtx) {
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
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', display: sortedDomains.length > 0 }, tooltip: { ...pieTooltipCallback, enabled: sortedDomains.length > 0 } } }
    });
  }

  const sizeCounts = { 'Moins de 10': 0, '10-49': 0, '50-249': 0, '250 et plus': 0, 'Toutes tailles': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (!aide) return;
        let found = false;
        const effectifStr = (aide.effectif && typeof aide.effectif === 'string' ? aide.effectif : '').toLowerCase();
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
  const sizeCtx = ensureChartContainer('size-chart', "Répartition par taille d'entreprise", chartsGrid);
  if (sizeCtx) {
    if (sizeChart) { sizeChart.destroy(); }
    sizeChart = new Chart(sizeCtx, {
        type: 'bar',
        data: {
        labels: Object.keys(sizeCounts),
        datasets: [{ label: "Nombre d'aides", data: Object.values(sizeCounts), backgroundColor: '#1e40af' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: aides.length > 0 ? undefined : 10 } } }
    });
  }

  const regionCounts = { 'Nationale': 0, 'Territoriale': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (!aide) return;
        if (aide.couverture_geo === 'aide nationale') regionCounts['Nationale']++;
        else if (aide.couverture_geo === 'aide territoriale') regionCounts['Territoriale']++;
        else regionCounts['Non spécifié']++;
    });
  }
  const regionCtx = ensureChartContainer('region-chart', 'Répartition Nationale/Territoriale', chartsGrid);
  if (regionCtx) {
    if (regionChart) { regionChart.destroy(); }
    regionChart = new Chart(regionCtx, {
        type: 'doughnut',
        data: {
        labels: aides.length > 0 ? Object.keys(regionCounts) : ['Aucune donnée'],
        datasets: [{ data: aides.length > 0 ? Object.values(regionCounts) : [1], backgroundColor: aides.length > 0 ? ['#1e40af', '#10b981', '#64748b'] : ['#cccccc']}]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', display: aides.length > 0 }, tooltip: { ...pieTooltipCallback, enabled: aides.length > 0 } } }
    });
  }

  const ageCounts = { 'Moins de 3 ans': 0, 'Plus de 3 ans': 0, 'Tout âge': 0, 'Non spécifié': 0 };
  if (aides.length > 0) {
    aides.forEach(aide => {
        if (!aide) return;
        const ageEntrepriseStr = aide.age_entreprise && typeof aide.age_entreprise === 'string' ? aide.age_entreprise : '';
        if (!ageEntrepriseStr) ageCounts['Non spécifié']++;
        else if (ageEntrepriseStr.includes('- de 3 ans')) ageCounts['Moins de 3 ans']++;
        else if (ageEntrepriseStr.includes('+ de 3 ans')) ageCounts['Plus de 3 ans']++;
        else ageCounts['Tout âge']++;
    });
  }
  const ageCtx = ensureChartContainer('age-chart', "Répartition par âge d'entreprise requis", chartsGrid);
  if(ageCtx){
    if (ageChart) { ageChart.destroy(); }
    ageChart = new Chart(ageCtx, {
        type: 'bar',
        data: {
        labels: Object.keys(ageCounts),
        datasets: [{ label: "Nombre d'aides", data: Object.values(ageCounts), backgroundColor: '#f59e0b' }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, suggestedMax: aides.length > 0 ? undefined : 10 } } }
    });
  }
}

function displayAidCards(aides, page = 1) {
  const gridContainer = document.getElementById('funding-grid');
  if (!gridContainer) {
    console.error("Funding grid container not found!");
    return;
  }
  gridContainer.innerHTML = "";
  const itemsPerPage = 6;
  const startIndex = (page - 1) * itemsPerPage;
  const allAides = Array.isArray(aides) ? aides : [];
  const endIndex = Math.min(startIndex + itemsPerPage, allAides.length);
  const displayedAides = allAides.slice(startIndex, endIndex);

  if (allAides.length === 0) {
    gridContainer.innerHTML = '<div class="no-results" style="text-align:center; padding:2rem; color:var(--gray);">Aucune aide trouvée.</div>';
    const paginationEl = document.getElementById('pagination');
    if (paginationEl) paginationEl.innerHTML = '';
    return;
  }

  displayedAides.forEach(aide => {
    if (!aide) return;
    const card = document.createElement('div');
    card.className = 'funding-card';
    card.dataset.id = aide.id_aid || `unknown-${Math.random().toString(36).substr(2, 9)}`;

    const effectifs = (aide.effectif && typeof aide.effectif === 'string' ? aide.effectif : 'Non spécifié')
      .split(',')
      .map(eff => eff.trim())
      .map(eff => {
        if (eff === '-10') return 'Moins de 10 salariés';
        if (eff === '-5') return 'Moins de 5 salariés';
        return eff;
      })
      .join(', ');

    const ageEntreprise = (aide.age_entreprise && typeof aide.age_entreprise === 'string' ? aide.age_entreprise : 'Non spécifié');
    const categories = (aide.id_domaine && typeof aide.id_domaine === 'string' ? aide.id_domaine : 'Non spécifié').split(',').map(cat => cat.trim()).join(', ');

    card.innerHTML = `
      <div class="funding-card-header">
        <h3 class="funding-card-title">${aide.aid_nom || 'Sans titre'}</h3>
        <div class="funding-card-subtitle">${(aide.couverture_geo || 'Non spécifié')} - ${categories}</div>
      </div>
      <div class="funding-card-body">
        <div class="funding-info-item">
          <div class="funding-info-label">Objectif</div>
          <div class="funding-info-value">${aide.aid_objet ? truncateText(String(aide.aid_objet), 150) : 'Non spécifié'}</div>
        </div>
        <div class="funding-info-item">
          <div class="funding-info-label">Bénéficiaires</div>
          <div class="funding-info-value">${aide.aid_benef ? truncateText(String(aide.aid_benef), 100) : 'Non spécifié'}</div>
        </div>
      </div>
      <div class="funding-card-footer">
        <div class="funding-tags">
          <div class="funding-tag">${effectifs}</div>
          <div class="funding-tag">${ageEntreprise}</div>
        </div>
        <button class="cta-button secondary view-details" data-id="${aide.id_aid || ''}">Voir les détails</button>
      </div>
    `;
    gridContainer.appendChild(card);
  });

  document.querySelectorAll('.view-details').forEach(button => {
    button.addEventListener('click', function() {
      const aideId = this.getAttribute('data-id');
      if (!aideId) {
        console.warn("View details: no ID on card.");
        return;
      }
      const sourceAides = window.currentAides || [];
      const aide = sourceAides.find(a => a && String(a.id_aid) === aideId);
      if (aide) { showAideDetails(aide); }
      else { console.error("Aide non trouvée pour ID:", aideId); }
    });
  });

  createPagination(allAides.length, itemsPerPage, page);
}

function truncateText(text, maxLength) {
  if (typeof text !== 'string') text = String(text);
  return text.length <= maxLength ? text : text.substring(0, maxLength) + '...';
}

function createPagination(totalItems, itemsPerPage, currentPage) {
  const totalPages = Math.ceil(totalItems / itemsPerPage);
  const paginationContainer = document.getElementById('pagination');
  if (!paginationContainer) return;
  paginationContainer.innerHTML = "";

  if (totalPages <= 1) return;

  const createPageButton = (text, pageNum, isDisabled = false, isActive = false) => {
    const button = document.createElement('button');
    button.className = 'pagination-button';
    button.innerHTML = text;
    button.disabled = isDisabled;
    if (isActive) button.classList.add('active');
    button.addEventListener('click', () => {
      const filteredAides = getFilteredAides(window.currentAides || []);
      displayAidCards(filteredAides, pageNum);
    });
    return button;
  };
  
  paginationContainer.appendChild(createPageButton('«', currentPage - 1, currentPage === 1));

  const maxVisiblePages = 5;
  let startPage = Math.max(1, currentPage - Math.floor(maxVisiblePages / 2));
  let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage + 1 < maxVisiblePages && totalPages >= maxVisiblePages) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  } else if (totalPages < maxVisiblePages) {
    startPage = 1;
    endPage = totalPages;
  }

  if (startPage > 1) {
    paginationContainer.appendChild(createPageButton('1', 1));
    if (startPage > 2) {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.textContent = '...';
        paginationContainer.appendChild(ellipsis);
    }
  }

  for (let i = startPage; i <= endPage; i++) {
    paginationContainer.appendChild(createPageButton(i, i, false, i === currentPage));
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
        const ellipsis = document.createElement('span');
        ellipsis.className = 'pagination-ellipsis';
        ellipsis.textContent = '...';
        paginationContainer.appendChild(ellipsis);
    }
    paginationContainer.appendChild(createPageButton(totalPages, totalPages));
  }
  
  paginationContainer.appendChild(createPageButton('»', currentPage + 1, currentPage === totalPages));
}

function initSearchAndFilters(aidesInput) {
  const aides = Array.isArray(aidesInput) ? aidesInput : [];
  window.currentAides = aides; 

  const searchForm = document.getElementById('search-form');
  const applyFiltersBtn = document.getElementById('apply-filters');
  const resetFiltersBtn = document.getElementById('reset-filters');
  const categorySelect = document.getElementById('category');

  const performSearchAndFilter = () => {
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const filteredAides = getFilteredAides(window.currentAides || [], searchTerm); 
    displayAidCards(filteredAides, 1);
  };

  if(searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      performSearchAndFilter();
    });
  }

  if(applyFiltersBtn) {
    applyFiltersBtn.addEventListener('click', performSearchAndFilter);
  }

  if(resetFiltersBtn) {
    resetFiltersBtn.addEventListener('click', () => {
      const searchInput = document.getElementById('search-input');
      if(searchInput) searchInput.value = '';
      if(categorySelect) categorySelect.value = '';
      document.getElementById('company-size').value = '';
      document.getElementById('company-age').value = '';
      document.getElementById('geography').value = '';
      displayAidCards(window.currentAides || [], 1); 
    });
  }

  if(categorySelect) {
    const categories = new Set();
    if (aides.length > 0) {
      aides.forEach(aide => {
          if (aide && aide.id_domaine && typeof aide.id_domaine === 'string') {
            aide.id_domaine.split(',').map(cat => cat.trim()).forEach(cat => {
                if (cat) categories.add(cat);
            });
          }
      });
    }
    const sortedCategories = Array.from(categories).sort((a, b) => a.localeCompare(b, 'fr'));
    
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
}

function getFilteredAides(allAidesInput, searchTerm = null) {
  const allAides = Array.isArray(allAidesInput) ? allAidesInput : [];

  const searchInputEl = document.getElementById('search-input');
  const currentSearchTerm = (searchTerm !== null ? searchTerm : (searchInputEl ? searchInputEl.value.toLowerCase().trim() : ""))
                            .normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 

  const category = document.getElementById('category').value;
  const companySize = document.getElementById('company-size').value;
  const companyAge = document.getElementById('company-age').value;
  const geography = document.getElementById('geography').value;

  return allAides.filter(aide => {
    if (!aide) return false;

    if (currentSearchTerm) {
      const name = (aide.aid_nom || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const objet = (aide.aid_objet || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const benef = (aide.aid_benef || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const domaine = (aide.id_domaine || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!name.includes(currentSearchTerm) && !objet.includes(currentSearchTerm) &&
          !benef.includes(currentSearchTerm) && !domaine.includes(currentSearchTerm)) {
        return false;
      }
    }

    if (category && (!aide.id_domaine || !aide.id_domaine.split(',').map(c => c.trim()).includes(category))) {
      return false;
    }

    if (companySize) {
        const aideEffectif = (aide.effectif || '').toLowerCase();
        if (!aideEffectif.includes('tous') && !aideEffectif.includes('all')) { 
            let sizeMatch = false;
            if (companySize === "-10" && (aideEffectif.includes('-10') || aideEffectif.includes('-5'))) sizeMatch = true;
            else if (companySize === "10-49" && aideEffectif.includes('10-49')) sizeMatch = true;
            else if (companySize === "50-249" && aideEffectif.includes('50-249')) sizeMatch = true;
            else if (companySize === "250 et plus" && aideEffectif.includes('250 et plus')) sizeMatch = true;
            if (!sizeMatch) return false;
        }
    }

    if (companyAge) {
      const aideAge = (aide.age_entreprise || '').toLowerCase();
      if (!aideAge.includes('tout') && !aideAge.includes('all') && !aideAge.includes(companyAge.toLowerCase())) {
        return false;
      }
    }

    if (geography && aide.couverture_geo !== geography) {
      return false;
    }

    return true;
  });
}

function showAideDetails(aide) {
  if (!aide) {
    console.error("showAideDetails: aide est null/undefined.");
    return;
  }
  const modal = document.getElementById('detail-modal');
  const modalTitle = document.getElementById('modal-title');
  const modalSubtitle = document.getElementById('modal-subtitle');
  const modalBody = document.getElementById('modal-body');

  if (!modal || !modalTitle || !modalSubtitle || !modalBody) {
    console.error("Éléments du modal non trouvés!");
    return;
  }

  modalTitle.textContent = aide.aid_nom || 'Sans titre';
  const categories = (aide.id_domaine || 'Non spécifié').split(',').map(cat => cat.trim()).join(', ');
  modalSubtitle.textContent = `${(aide.couverture_geo || 'Non spécifié')} - ${categories}`;

  let bodyContent = "";
  const addDetailSection = (title, content) => {
    const cleanContent = (content && typeof content === 'string') ? content.trim() : '';
    if (cleanContent) {
      bodyContent += `<div class="modal-section"><h3 class="modal-section-title">${title}</h3><div class="modal-text">${cleanContent}</div></div>`;
    }
  };

  addDetailSection('Objectif', aide.aid_objet);
  addDetailSection('Opérations éligibles', aide.aid_operations_el);
  addDetailSection('Conditions', aide.aid_conditions);
  addDetailSection('Montant', aide.aid_montant);
  addDetailSection('Bénéficiaires', aide.aid_benef);

  let complementInfo = `<p><strong>Taille d'entreprise :</strong> ${(aide.effectif || 'Non spécifié')}</p>
                        <p><strong>Âge d'entreprise :</strong> ${(aide.age_entreprise || 'Non spécifié')}</p>
                        <p><strong>Date de fin :</strong> ${(aide.aid_validation || 'Non spécifié')}</p>`;
  addDetailSection('Informations complémentaires', complementInfo);

  let linksContent = "";
  if (aide.complements_sources) linksContent += `<p><strong>Sources :</strong> ${formatLinks(aide.complements_sources)}</p>`;
  if (aide.complements_formulaires) linksContent += `<p><strong>Formulaires :</strong> ${formatLinks(aide.complements_formulaires)}</p>`;
  if (linksContent) addDetailSection('Liens utiles', linksContent);

  modalBody.innerHTML = bodyContent || '<p>Aucun détail spécifique disponible.</p>';
  modal.classList.add('open');
}

function formatLinks(text) {
  if (!text || typeof text !== 'string') return "";
  const urlRegex = /(https?:\/\/[^\s"<>]+)/g;
  return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--primary); text-decoration:underline;">$1</a>');
}

function initModal() {
  const modal = document.getElementById('detail-modal');
  const modalContent = modal?.querySelector('.modal-content'); 
  const closeBtn = document.getElementById('modal-close');
  const closeBtnFooter = document.getElementById('modal-close-btn');

  if (!modal || !modalContent || !closeBtn || !closeBtnFooter) {
    console.warn("Éléments du modal manquants.");
    return;
  }

  const closeModal = () => modal.classList.remove('open');
  closeBtn.addEventListener('click', closeModal);
  closeBtnFooter.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  modalContent.addEventListener('click', (e) => e.stopPropagation());
}

document.addEventListener('DOMContentLoaded', function() {
  console.log("DOM chargé.");
  initModal();

  updateStatistics([]);
  createCharts([]);
  displayAidCards([]); 
  initSearchAndFilters([]); 

  const DATA_URL = "https://bros-ai.github.io/Aide-Financement-Entreprise/aides.csv";
  
  loadDataFromURLManualFetch(DATA_URL)
    .then(() => {
      console.log("Chargement initial des données terminé.");
    })
    .catch(error => { 
      console.error("Erreur critique loadDataFromURLManualFetch:", error);
      const fundingGrid = document.getElementById('funding-grid');
      if (fundingGrid) {
        fundingGrid.innerHTML = `<div style="text-align:center; padding:2rem; color:#e11d48;">ERREUR FATALE: ${error.message}</div>`;
      }
    });
});

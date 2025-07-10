window.addEventListener('load', () => {
    // Tanoth Rozšírený Inventár Script
    (function() {
        'use strict';

        // Nastavenia
        const API_URL = window.location.href.split('/main')[0] + '/xmlrpc';
        const SESSION_ID = localStorage.getItem('tanothSessionID');

        // Mapovanie typu predmetu na slot vybavenia
        const ITEM_SLOTS = {
            1: "amulet", 2: "brnenie", 3: "topanky", 4: "rukavice", 5: "prilba",
            6: "prsten", 7: "stit", 8: "mec"
            // Typ 9 (lektvary) nie sú vybaviteľné
        };

        // Mapovanie typu na priečinky obrázkov
        const ITEM_TYPE_FOLDERS = {
            1: "pendant", 2: "armor", 3: "boots", 4: "gloves", 5: "helm",
            6: "ring", 7: "shield", 8: "weapon", 9: "misc"
        };

        // Farby pre zriedkavosť/kvalitu predmetov
        const ITEM_COLORS = {
            unique: "#ff6b35", rare: "#3498db", common: "#95a5a6"
        };

        let currentCharacter = 0; // 0 pre hlavnú postavu, 1, 2, 3 pre žoldnierov
        let inventoryData = []; // Bude uchovávať vybavené predmety hlavnej postavy PLUS všetky predmety z batohu
        let companionEquippedData = [[], [], []]; // Bude uchovávať IBA vybavené predmety pre každého žoldniera

        let currentFilters = {
            type: 'all',
            rarity: 'all',
            runed: 'all'
        };

        // 🔥 GLOBÁLNA PREMENNÁ PRE ULOŽENIE RÚNOVÝCH BONUSOV
        let RUNE_BONUS = { str: 0, dex: 0, con: 0, int: 0 };

        // --- Optimalizácie výkonu ---
        const preloadedImageURLs = new Set(); // Pre zamedzenie duplicitného preloadovania obrázkov

        // Funkcia pre preloadovanie obrázkov
        function preloadAllItemImages(...itemCollections) {
            itemCollections.flat().forEach(item => {
                if (item) {
                    const url = getItemImageURL(item);
                    if (url && !preloadedImageURLs.has(url)) {
                        const img = new Image();
                        img.src = url; // Toto spustí načítanie a uloženie obrázka do cache
                        preloadedImageURLs.add(url);
                    }
                }
            });
       }
        // --- Koniec optimalizácií výkonu ---

        // 🔥 KROK 1: NAČÍTAJ RÚNOVÉ BONUSY NAJPRV
        async function loadRuneBonus() {
            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml' },
                    body: `<methodCall><methodName>EvocationCircle_getCircle</methodName><params><param><value><string>${SESSION_ID}</string></value></param></params></methodCall>`,
                    credentials: 'include'
                });

                const xmlText = await response.text();
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

                const runeMapping = { '11': 'str', '12': 'dex', '13': 'con', '14': 'int' };
                const structNode = xmlDoc.querySelector('methodResponse params param value struct');

                if (structNode) {
                    const members = structNode.querySelectorAll('member');
                    members.forEach(member => {
                        const nameNode = member.querySelector('name');
                        const valueNode = member.querySelector('value string');

                        if (nameNode && valueNode) {
                            const runeId = nameNode.textContent;
                            const statName = runeMapping[runeId];

                            if (statName) {
                                const dataString = valueNode.textContent;
                                const firstValue = parseFloat(dataString.split(':')[0]);
                                const percentage = isNaN(firstValue) ? 0 : firstValue / 2;
                                RUNE_BONUS[statName] = percentage;
                            }
                        }
                    });
                }

            } catch (error) {
                console.error('❌ Chyba pri načítavaní rún:', error);
                // Testové hodnoty pre vývoj/zálohu ak API zlyhá
                RUNE_BONUS = { str: 50, dex: 50, con: 50, int: 50 };
            }
        }

        // Vykonanie API požiadavky
        async function makeAPIRequest(methodName, params = []) {
            const body = `<methodCall><methodName>${methodName}</methodName><params>${params.map(param => {
                if (typeof param === 'string') {
                    return `<param><value><string>${param}</string></value></param>`;
                } else if (typeof param === 'number') {
                    return `<param><value><int>${param}</int></value></param>`;
                }
            }).join('')}</params></methodCall>`;

            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'text/xml', 'Accept': '*/*' },
                    body: body,
                    credentials: 'include'
                });

                const xmlText = await response.text();
                return parseXMLResponse(xmlText);
            } catch (error) {
                console.error(`Chyba API požiadavky pre ${methodName}:`, error);
                return null;
            }
        }

        // Parsovanie XML odpovede
        function parseXMLResponse(xmlText) {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlText, 'text/xml');

            const items = [];
            const itemNodes = xmlDoc.querySelectorAll('data > value > struct');

            itemNodes.forEach(itemNode => {
                const item = {};
                const members = itemNode.querySelectorAll('member');

                members.forEach(member => {
                    const name = member.querySelector('name').textContent;
                    const valueNode = member.querySelector('value');

                    if (name === 'attributes') {
                        item.attributes = {};
                        const attrMembers = valueNode.querySelectorAll('member');
                        attrMembers.forEach(attrMember => {
                            const attrName = attrMember.querySelector('name').textContent;
                            const attrValue = parseInt(attrMember.querySelector('i4').textContent);
                            item.attributes[attrName] = attrValue;
                        });
                    } else {
                        const value = valueNode.querySelector('i4, boolean, string, double');
                        if (value) {
                            if (value.tagName === 'boolean') {
                                item[name] = value.textContent === '1';
                            } else if (value.tagName === 'i4') {
                                item[name] = parseInt(value.textContent);
                            } else {
                                item[name] = value.textContent;
                            }
                        }
                    }
                });

                items.push(item);
            });

            return items;
        }

        // Generovanie URL obrázka predmetu
        function getItemImageURL(item) {
            const url = window.location.href.split('/main')[0] 
            const baseURL = `${url}/main/client/assets/gfx/item/`;

            if (item.type === 9) {
                const potionMap = {
                    1: "st_trank1.png", 2: "st_trank2.png", 3: "st_trank3.png",
                    4: "ge_trank1.png", 5: "ge_trank2.png", 6: "ge_trank3.png",
                    7: "co_trank1.png", 8: "co_trank2.png", 9: "co_trank3.png",
                    10: "it_trank1.png", 11: "it_trank2.png", 12: "it_trank3.png",
                    13: "st_elixier.png", 14: "ge_elixier.png", 15: "it_elixier.png",
                    16: "co_elixier.png", 17: "gold_potion.png", 18: "rune_off2_tip.png",
                    19: "rune_def2.png", 20: "rune_off3_tip.png", 21: "rune_def3.png",
                    22: "rune_off1_tip.png", 23: "rune_def1.png"
                };

                const imageName = potionMap[item.item];
                if (imageName) {
                    return `${baseURL}alchi/${imageName}`;
                }
                return `${baseURL}alchi/st_trank1.png`;
            }

            if (item.is_unique) {
                return `${baseURL}unique/unique${item.item}.png`;
            } else {
                const folder = ITEM_TYPE_FOLDERS[item.type];
                if (folder) {
                    return `${baseURL}${folder}/item_${folder}${item.item}.png`;
                }
                return `${baseURL}misc/item_misc${item.item}.png`;
            }
        }

        // Vytvorenie prvku obrázka predmetu
        function createItemImage(item) {
            const img = document.createElement('img');
            img.className = 'item-image';
            img.src = getItemImageURL(item);
            img.alt = `Predmet ${item.item}`;

            img.onerror = function() {
                this.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiBmaWxsPSIjMzQ0OTVlIiBzdHJva2U9IiM3ZjhjOGQiIHN0cm9rZS13aWR0aD0iMiIvPgo8dGV4dCB4PSIyMCIgeT0iMjQiIGZpbGw9IiNlY2YwZjEiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxMiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+Pz88L3RleHQ+Cjwvc3ZnPgo=';
            };

            return img;
        }

        // Vytvorenie prvku názvu predmetu
        function createItemName(item) {
            const nameDiv = document.createElement('div');
            nameDiv.className = 'item-name';
            nameDiv.textContent = getItemTypeName(item.type);
            return nameDiv;
        }

        // 🔥 APLIKOVANIE RÚNOVÝCH BONUSOV NA ATRIBÚTY
        function applyRuneBonus(value, attributeName) {
            const runeMap = {
                'bonus_str': 'str', 'bonus_dex': 'dex',
                'bonus_con': 'con', 'bonus_int': 'int'
            };

            const runeStat = runeMap[attributeName];
            if (runeStat && RUNE_BONUS[runeStat] > 0) {
                const bonusAmount = Math.floor((value * RUNE_BONUS[runeStat]) / 100);
                const finalValue = value + bonusAmount;
                return { final: finalValue, original: value, bonus: bonusAmount };
            }

            return { final: value, original: value, bonus: 0 };
        }

        // Získanie názvu typu predmetu
        function getItemTypeName(type) {
            const typeNames = {
                1: 'Amulet', 2: 'Brnenie', 3: 'Topánky', 4: 'Rukavice', 5: 'Prilba',
                6: 'Prsteň', 7: 'Štít', 8: 'Meč', 9: 'Lektvar/Rúna'
            };
            return typeNames[type] || 'Neznámy';
        }

        // Kontrola či je použiteľný lektvar
        function isUsablePotion(item) {
            if (item.type !== 9) return false;
            const usablePotions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];
            return usablePotions.includes(item.item);
        }

        function getPotionName(item) {
            if (item.type !== 9) return '';
            const potionNames = {
                1: "Malý lektvar sily", 2: "Stredný lektvar sily", 3: "Veľký lektvar sily",
                4: "Malý lektvar obratnosti", 5: "Stredný lektvar obratnosti", 6: "Veľký lektvar obratnosti",
                7: "Malý lektvar odolnosti", 8: "Stredný lektvar odolnosti", 9: "Veľký lektvar odolnosti",
                10: "Malý lektvar inteligencie", 11: "Stredný lektvar inteligencie", 12: "Veľký lektvar inteligencie",
                13: "Elixír sily", 14: "Elixír obratnosti", 15: "Elixír inteligencie",
                16: "Elixír odolnosti", 17: "Lektvar večnej mladosti",
                18: "Malá rúna moci (+5 poškodenie)", 19: "Stredná rúna ochrany (+5 brnenie)",
                20: "Veľká rúna moci (+10 poškodenie)", 21: "Veľká rúna ochrany (+10 brnenie)",
                22: "Najmenšia rúna moci (+1 poškodenie)", 23: "Najmenšia rúna ochrany (+1 brnenie)"
            };
            return potionNames[item.item] || `Lektvar/Rúna ${item.item}`;
        }

        // Formátovanie názvu atribútu
        function formatStatName(statName) {
            const statNames = {
                'bonus_str': 'Sila', 'bonus_dex': 'Obratnosť', 'bonus_int': 'Inteligencia',
                'bonus_con': 'Odolnosť', 'malus_con': 'Protivná odolnosť',
                'malus_str': 'Protivná sila', 'malus_dex': 'Protivná obratnosť', 'malus_int': 'Protivná inteligencia',
                'rune_bonus': 'Rúnový bonus'
            };
            return statNames[statName] || statName;
        }

        // 🔥 VYTVORENIE TOOLTIPA S VYPOČÍTANÝM BONUSOM (BEZ DETAILNÉHO VÝPOČTU)
        function createTooltip(item) {
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip';

            const rarity = item.is_unique ? 'Unikátny' : 'Bežný';
            const rarityColor = item.is_unique ? ITEM_COLORS.unique : ITEM_COLORS.common;
            const typeName = getItemTypeName(item.type);

            let itemTitle = typeName;
            if (item.type === 9) {
                itemTitle = getPotionName(item);
            }

            let statsHTML = '';
            if (item.attributes) {
                Object.entries(item.attributes).forEach(([key, value]) => {
                    if (key === 'value1' || key === 'value2' || key === 'rune_bonus' || value === 0 || key === 'selfincrease') {
                        return;
                    }

                    if (['bonus_str', 'bonus_dex', 'bonus_con', 'bonus_int'].includes(key)) {
                        const result = applyRuneBonus(value, key);
                        const statName = formatStatName(key);
                        if (result.bonus > 0) {
                            statsHTML += `<div class="stat-line"><span>${statName}:</span><span style="color: #f39c12">+${result.final}</span></div>`;
                        } else {
                            statsHTML += `<div class="stat-line"><span>${statName}:</span><span style="color: #27ae60">+${result.final}</span></div>`;
                        }
                    } else {
                        const statName = formatStatName(key);
                        const statValue = value > 0 ? `+${value}` : `-${Math.abs(value)}`;
                        const color = value > 0 ? '#27ae60' : '#e74c3c';
                        statsHTML += `<div class="stat-line"><span>${statName}:</span><span style="color: ${color}">${statValue}</span></div>`;
                    }
                });
            }

            let armorOrDamageHTML = '';
            if (item.attributes) {
                const value1 = item.attributes.value1 || 0;
                const value2 = item.attributes.value2 || 0;
                const runeItemBonus = item.attributes.rune_bonus || 0;

                if (item.type === 8) { // Zbraň
                    const minDamage = value1 + runeItemBonus;
                    const maxDamage = value2 + runeItemBonus;
                    armorOrDamageHTML = `<div class="stat-line"><span>Poškodenie:</span><span style="color: #e74c3c">${minDamage}-${maxDamage}</span></div>`;
                } else if (item.type >= 1 && item.type <= 7) { // Typy brnenia
                    const armor = value1 + runeItemBonus;
                    if (armor > 0) {
                        armorOrDamageHTML = `<div class="stat-line"><span>Brnenie:</span><span style="color: #3498db">${armor}</span></div>`;
                    }
                }
            }

            tooltip.innerHTML = `
                <h5 style="color: ${rarityColor}">${itemTitle}</h5>
                <div style="color: ${rarityColor}; font-weight: bold; margin-bottom: 8px;">${rarity}</div>
                ${armorOrDamageHTML}
                <div class="stats">${statsHTML}</div>
                <div class="stat-line"><span>Predajná hodnota: </span><span style="color: #f39c12">${item.sellvalue} zlata</span></div>
            `;

            return tooltip;
        }

        // Funkcie filtra
        function filterItems(items) {
            return items.filter(item => {
                // Filter typu
                if (currentFilters.type !== 'all' && item.type !== parseInt(currentFilters.type)) {
                    return false;
                }

                // Filter zriedkavosti
                if (currentFilters.rarity === 'unique' && !item.is_unique) {
                    return false;
                }
                if (currentFilters.rarity === 'common' && item.is_unique) {
                    return false;
                }

                // Filter rún
                if (currentFilters.runed === 'runed') {
                    if (!item.attributes || !item.attributes.rune_bonus || item.attributes.rune_bonus === 0) {
                        return false;
                    }
                }
                if (currentFilters.runed === 'not_runed') {
                    if (item.attributes && item.attributes.rune_bonus && item.attributes.rune_bonus > 0) {
                        return false;
                    }
                }

                return true;
            });
        }

        // Aktualizácia filtrov a opätovné vykreslenie
        async function updateFilters() {
            const typeSelect = document.getElementById('type-filter');
            const raritySelect = document.getElementById('rarity-filter');
            const runedSelect = document.getElementById('runed-filter');

            currentFilters.type = typeSelect.value;
            currentFilters.rarity = raritySelect.value;
            currentFilters.runed = runedSelect.value;

            // Opätovné vykreslenie aktuálneho pohľadu s novými filtrami
            await refreshCurrentView();
        }

        // Vytvorenie hlavného UI
        function createInventoryUI() {
            const existing = document.getElementById('tanoth-enhanced-inventory');
            if (existing) existing.remove();

            const inventoryDiv = document.createElement('div');
            inventoryDiv.id = 'tanoth-enhanced-inventory';
            inventoryDiv.innerHTML = `
                <div class="inventory-header">
                    <h3>Rozšírený inventár <span class="beta-tag">BETA</span></h3>
                    <div class="character-tabs">
                        <button class="char-tab active" data-char="0">Hlavná postava</button>
                        <button class="char-tab" data-char="1">Žoldnier 1</button>
                        <button class="char-tab" data-char="2">Žoldnier 2</button>
                        <button class="char-tab" data-char="3">Žoldnier 3</button>
                    </div>
                    <button class="close-btn">×</button>
                </div>
                <div class="filters-section">
                    <div class="filter-group">
                        <label for="type-filter">Typ:</label>
                        <select id="type-filter">
                            <option value="all">Všetky typy</option>
                            <option value="1">Amulet</option>
                            <option value="2">Brnenie</option>
                            <option value="3">Topánky</option>
                            <option value="4">Rukavice</option>
                            <option value="5">Prilba</option>
                            <option value="6">Prsteň</option>
                            <option value="7">Štít</option>
                            <option value="8">Meč</option>
                            <option value="9">Lektvar/Rúna</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="rarity-filter">Zriedkavosť:</label>
                        <select id="rarity-filter">
                            <option value="all">Všetky</option>
                            <option value="unique">Unikátne</option>
                            <option value="common">Bežné</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="runed-filter">Rúny:</label>
                        <select id="runed-filter">
                            <option value="all">Všetky predmety</option>
                            <option value="runed">S rúnami</option>
                            <option value="not_runed">Bez rún</option>
                        </select>
                    </div>
                </div>
                <div class="inventory-content">
                    <div class="equipped-section">
                        <h4>Vybavené</h4>
                        <div class="equipped-grid">
                            <div class="equipment-slot empty-slot"></div>
                            <div class="equipment-slot" data-slot="prilba">Prilba</div>
                            <div class="equipment-slot" data-slot="amulet">Amulet</div>
                            <div class="equipment-slot" data-slot="mec">Meč</div>
                            <div class="equipment-slot" data-slot="brnenie">Brnenie</div>
                            <div class="equipment-slot" data-slot="stit">Štít</div>
                            <div class="equipment-slot" data-slot="rukavice">Rukavice</div>
                            <div class="equipment-slot" data-slot="topanky">Topánky</div>
                            <div class="equipment-slot" data-slot="prsten">Prsteň</div>
                        </div>
                    </div>
                    <div class="inventory-section">
                        <h4>Batoh</h4>
                        <div class="inventory-grid"></div>
                    </div>
                </div>
                <div class="disclaimer-footer">
                    <strong>POZNÁMKA:</strong> Zmeny sa posielajú priamo na server Tanoth. Stránka môže vyzerať zastarané, ale akcie boli aplikované. Pre potvrdenie jednoducho presuňte ľubovoľný predmet vo vašom inventári alebo choďte k obchodníkovi.
                </div>
                                 <div class="loading">Načítava sa...</div>
             `;

            // Pridanie CSS štýlov a dokončenie UI
            const style = document.createElement('style');
            style.textContent = `
                #tanoth-enhanced-inventory {
                    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 1200px; height: 840px;
                    background: radial-gradient(circle at center, #2A231F 0%, #1A1612 100%);
                    border: 2px solid #8B6D45; border-radius: 8px; color: #D4D4D4; font-family: 'Georgia', serif;
                    z-index: 10000; overflow: hidden; display: flex; flex-direction: column;
                }
                .inventory-header { background: linear-gradient(to bottom, #4F3C28, #3A2B1D); padding: 15px; display: flex; justify-content: space-between; align-items: center; }
                .inventory-header h3 { margin: 0; color: #F3C96F; }
                .beta-tag { color: #e74c3c; font-size: 12px; font-weight: bold; }
                .character-tabs { display: flex; gap: 5px; }
                .char-tab { background: #2A231F; border: 1px solid #6F573B; color: #D4D4D4; padding: 8px 12px; border-radius: 5px; cursor: pointer; }
                .char-tab.active { background: linear-gradient(to bottom, #E0A34D, #C98B3B); color: #2A231F; font-weight: bold; }
                .close-btn { background: #A04040; border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; }
                .filters-section { background: #1A1612; padding: 15px; display: flex; gap: 20px; }
                .filter-group { display: flex; align-items: center; gap: 8px; }
                .filter-group label { color: #F3C96F; font-weight: bold; }
                .filter-group select { background: #2A231F; border: 1px solid #6F573B; color: #D4D4D4; padding: 6px 10px; border-radius: 4px; }
                .inventory-content { display: flex; flex-grow: 1; padding: 20px; gap: 30px; overflow: hidden; }
                .equipped-section { flex: 0 0 350px; }
                .inventory-section { flex: 1; min-width: 0; }
                .equipped-section h4, .inventory-section h4 { margin: 0 0 15px 0; color: #F3C96F; text-align: center; }
                .equipment-slot, .inventory-slot { background: #2A231F; border: 1px solid #5A4E45; border-radius: 4px; padding: 8px; text-align: center; min-height: 90px; display: flex; flex-direction: column; align-items: center; justify-content: center; cursor: pointer; }
                .item-image { width: 80%; height: 80%; object-fit: contain; margin-bottom: 5px; }
                .item-name { font-size: 11px; color: #F3C96F; font-weight: bold; }
                .equipped-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
                .inventory-grid { display: flex; flex-wrap: wrap; gap: 12px; height: 100%; overflow-y: auto; padding: 15px; background: #1A1612; border-radius: 8px; }
                .inventory-slot { min-height: 90px; min-width: 90px; padding: 10px; flex: 0 0 auto; }
                .tooltip { position: absolute; background: #2A231F; border: 2px solid #8B6D45; border-radius: 8px; padding: 15px; color: #D4D4D4; z-index: 10001; max-width: 300px; pointer-events: none; }
                .context-menu { position: absolute; background: #2A231F; border: 2px solid #8B6D45; border-radius: 8px; padding: 10px; z-index: 10002; }
                .context-menu button { display: block; width: 100%; background: #4F3C28; border: 1px solid #6F573B; color: #F3C96F; padding: 8px 15px; margin: 2px 0; border-radius: 5px; cursor: pointer; }
                .disclaimer-footer { padding: 10px 20px; font-size: 12px; color: #aaa; text-align: center; background: #1A1612; }
                .loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 18px; color: #F3C96F; display: none; }
            `;

            document.head.appendChild(style);
            document.body.appendChild(inventoryDiv);

            setupEventListeners();
            setupDelegatedEventListeners();
            loadAllInventoryData();
        }

        // Event listenery (pre statické elementy)
        function setupEventListeners() {
            const inventoryDiv = document.getElementById('tanoth-enhanced-inventory');
            inventoryDiv.querySelector('.close-btn').addEventListener('click', () => {
                inventoryDiv.remove();
                removeTooltips();
                removeContextMenus();
            });
            inventoryDiv.querySelectorAll('.char-tab').forEach(tab => {
                tab.addEventListener('click', async (e) => await switchCharacter(parseInt(e.target.dataset.char)));
            });

            document.getElementById('type-filter').addEventListener('change', updateFilters);
            document.getElementById('rarity-filter').addEventListener('change', updateFilters);
            document.getElementById('runed-filter').addEventListener('change', updateFilters);

            document.addEventListener('click', (e) => {
                if (!e.target.closest('.tooltip') && !e.target.closest('.context-menu')) {
                    removeTooltips();
                    removeContextMenus();
                }
            });
        }

        // Delegované event listenery pre sloty predmetov
        function setupDelegatedEventListeners() {
            const inventoryGrid = document.querySelector('.inventory-grid');
            const equippedGrid = document.querySelector('.equipped-grid');

            [inventoryGrid, equippedGrid].forEach(container => {
                let currentTooltipElement = null;

                container.addEventListener('mouseover', (e) => {
                    const slot = e.target.closest('.inventory-slot, .equipment-slot');
                    if (slot && slot.dataset.itemId) {
                        const itemId = parseInt(slot.dataset.itemId);
                        const item = findItemById(itemId);
                        if (item) {
                            removeTooltips();
                            const tooltip = createTooltip(item);
                            document.body.appendChild(tooltip);
                            currentTooltipElement = slot;

                            const rect = slot.getBoundingClientRect();
                            tooltip.style.left = (rect.right + 10) + 'px';
                            tooltip.style.top = rect.top + 'px';
                        }
                    }
                });

                container.addEventListener('mouseout', (e) => {
                    if (currentTooltipElement && e.relatedTarget && !e.relatedTarget.closest('.tooltip') && !currentTooltipElement.contains(e.relatedTarget)) {
                        removeTooltips();
                        currentTooltipElement = null;
                    }
                });

                container.addEventListener('click', (e) => {
                    const slot = e.target.closest('.inventory-slot, .equipment-slot');
                    if (slot && slot.dataset.itemId) {
                        e.preventDefault();
                        e.stopPropagation();

                        removeContextMenus();

                        const itemId = parseInt(slot.dataset.itemId);
                        const item = findItemById(itemId);

                        if (item) {
                            const menu = document.createElement('div');
                            menu.className = 'context-menu';

                            let isEquippedByCurrentCharacter = false;
                            if (currentCharacter === 0) {
                                isEquippedByCurrentCharacter = item.is_equipped && inventoryData.some(i => i.id === itemId && i.is_equipped);
                            } else {
                                isEquippedByCurrentCharacter = item.is_equipped && companionEquippedData[currentCharacter - 1].some(i => i.id === itemId && i.is_equipped);
                            }

                            if (isEquippedByCurrentCharacter) {
                                const unequipButton = document.createElement('button');
                                unequipButton.textContent = 'Odložiť';
                                unequipButton.addEventListener('click', async () => {
                                    removeContextMenus();
                                    await unequipItem(item.id, currentCharacter);
                                });
                                menu.appendChild(unequipButton);
                            } else if (item.type >= 1 && item.type <= 8) {
                                if (currentCharacter === 0) {
                                    const equipMainButton = document.createElement('button');
                                    equipMainButton.textContent = 'Vybaviť';
                                    equipMainButton.addEventListener('click', async () => {
                                        removeContextMenus();
                                        await equipItem(item.id);
                                    });
                                    menu.appendChild(equipMainButton);
                                } else {
                                    const equipCurrentCompanionButton = document.createElement('button');
                                    equipCurrentCompanionButton.textContent = `Vybaviť žoldnierovi ${currentCharacter}`;
                                    equipCurrentCompanionButton.addEventListener('click', async () => {
                                        removeContextMenus();
                                        await equipToCompanion(item.id, currentCharacter);
                                    });
                                    menu.appendChild(equipCurrentCompanionButton);
                                }

                                if (currentCharacter !== 0) {
                                    const equipMainButton = document.createElement('button');
                                    equipMainButton.textContent = 'Vybaviť hlavnej postave';
                                    equipMainButton.addEventListener('click', async () => {
                                        removeContextMenus();
                                        await equipItem(item.id);
                                    });
                                    menu.appendChild(equipMainButton);
                                }
                                for (let i = 1; i <= 3; i++) {
                                    if (i !== currentCharacter || (currentCharacter === 0 && i !== 0)) {
                                        const equipCompanionButton = document.createElement('button');
                                        equipCompanionButton.textContent = `Vybaviť žoldnierovi ${i}`;
                                        equipCompanionButton.addEventListener('click', async () => {
                                            removeContextMenus();
                                            await equipToCompanion(item.id, i);
                                        });
                                        menu.appendChild(equipCompanionButton);
                                    }
                                }
                            } else if (isUsablePotion(item)) {
                                const useButton = document.createElement('button');
                                useButton.textContent = 'Použiť';
                                useButton.addEventListener('click', async () => {
                                    removeContextMenus();
                                    await usePotion(item.id);
                                });
                                menu.appendChild(useButton);
                            }

                            if (menu.children.length > 0) {
                                document.body.appendChild(menu);
                                const rect = slot.getBoundingClientRect();
                                menu.style.left = (rect.right + 10) + 'px';
                                menu.style.top = rect.top + 'px';
                            }
                        }
                    }
                }, true);
            });

            function findItemById(itemId) {
                let currentViewItems = [];
                if (currentCharacter === 0) {
                    currentViewItems = inventoryData;
                } else {
                    currentViewItems = [...companionEquippedData[currentCharacter - 1], ...inventoryData.filter(item => !item.is_equipped)];
                }
                let item = currentViewItems.find(i => i.id === itemId);
                if (item) return item;

                item = inventoryData.find(i => i.id === itemId);
                if (item) return item;

                for (let i = 0; i < companionEquippedData.length; i++) {
                    item = companionEquippedData[i].find(i => i.id === itemId);
                    if (item) return item;
                }
                return null;
            }
        }

        // Načítanie VŠETKÝCH dát inventára (hlavná postava + všetci žoldnieri)
        async function loadAllInventoryData() {
            showLoading(true);
            try {
                const [mainItems, merc1Items, merc2Items, merc3Items] = await Promise.all([
                    makeAPIRequest('GetEquipment', [SESSION_ID]),
                    makeAPIRequest('GetPartyItems', [SESSION_ID, 1]),
                    makeAPIRequest('GetPartyItems', [SESSION_ID, 2]),
                    makeAPIRequest('GetPartyItems', [SESSION_ID, 3])
                ]);

                inventoryData = mainItems || [];
                companionEquippedData = [merc1Items || [], merc2Items || [], merc3Items || []];

                preloadAllItemImages(inventoryData, ...companionEquippedData);

            } catch (error) {
                console.error("Chyba pri načítavaní dát inventára:", error);
            } finally {
                await refreshCurrentView();
                showLoading(false);
            }
        }

        // Obnovenie aktuálne zobrazeného pohľadu
        async function refreshCurrentView() {
            let itemsToDisplay = [];
            if (currentCharacter === 0) {
                itemsToDisplay = inventoryData;
            } else {
                const equippedForCurrentCompanion = companionEquippedData[currentCharacter - 1];
                const unequippedItemsInBackpack = inventoryData.filter(item => !item.is_equipped);
                itemsToDisplay = [...equippedForCurrentCompanion, ...unequippedItemsInBackpack];
            }
            renderInventory(itemsToDisplay);
        }

        // Prepnutie aktívnej postavy
        async function switchCharacter(charIndex) {
            currentCharacter = charIndex;
            document.querySelectorAll('.char-tab').forEach(tab => tab.classList.remove('active'));
            document.querySelector(`[data-char="${charIndex}"]`).classList.add('active');

            await refreshCurrentView();
        }

        // Vykreslenie inventára pre aktuálnu postavu
        function renderInventory(itemsToDisplay) {
            renderEquippedItems(itemsToDisplay);
            renderInventoryGrid(itemsToDisplay);
        }

        // Vykreslenie vybavených predmetov
        function renderEquippedItems(items) {
            const equippedSlots = document.querySelectorAll('.equipment-slot');
            equippedSlots.forEach(slot => {
                if (slot.classList.contains('empty-slot')) return;
                slot.classList.remove('has-item');
                const slotName = slot.dataset.slot;
                slot.innerHTML = slotName.charAt(0).toUpperCase() + slotName.slice(1);
                slot.removeAttribute('data-item-id');
            });

            const itemsEquippedByCurrentCharacter = items.filter(item => {
                if (!item.is_equipped) return false;
                if (currentCharacter === 0) {
                    return inventoryData.some(i => i.id === item.id && i.is_equipped);
                } else {
                    return companionEquippedData[currentCharacter - 1].some(i => i.id === item.id && i.is_equipped);
                }
            });

            itemsEquippedByCurrentCharacter.forEach(item => {
                const slotType = ITEM_SLOTS[item.type];
                if (slotType) {
                    const slot = document.querySelector(`.equipment-slot[data-slot="${slotType}"]`);
                    if (slot) {
                        slot.classList.add('has-item');
                        slot.innerHTML = '';
                        slot.appendChild(createItemImage(item));
                        slot.appendChild(createItemName(item));
                        slot.dataset.itemId = item.id;
                    }
                }
            });
        }

        // Vykreslenie mriežky inventára
        function renderInventoryGrid(items) {
            const inventoryGrid = document.querySelector('.inventory-grid');
            inventoryGrid.innerHTML = '';

            const fragment = document.createDocumentFragment();

            const unequippedItems = items.filter(item => !item.is_equipped);
            const filteredItems = filterItems(unequippedItems);

            filteredItems.forEach(item => {
                const slot = document.createElement('div');
                slot.className = 'inventory-slot has-item';
                if (item.is_unique) slot.classList.add('unique');

                slot.appendChild(createItemImage(item));
                slot.appendChild(createItemName(item));
                slot.dataset.itemId = item.id;

                fragment.appendChild(slot);
            });
            inventoryGrid.appendChild(fragment);
        }

        // Funkcie akcií s predmetmi
        async function usePotion(itemId) {
            showLoading(true);
            await makeAPIRequest('UsePotion', [SESSION_ID, itemId]);
            await loadAllInventoryData();
            showLoading(false);
        }

        async function equipItem(itemId) {
            showLoading(true);
            await makeAPIRequest('MoveItem', [SESSION_ID, itemId, -1, -1]);
            await loadAllInventoryData();
            showLoading(false);
        }

        async function unequipItem(itemId, fromCharacterIndex) {
            showLoading(true);
            if (fromCharacterIndex === 0) {
                await makeAPIRequest('MoveItem', [SESSION_ID, itemId, 30, 30]);
            } else {
                await makeAPIRequest('MoveCompanionItem', [SESSION_ID, itemId, fromCharacterIndex, 30, 30]);
            }
            await loadAllInventoryData();
            showLoading(false);
        }

        async function equipToCompanion(itemId, companionIndex) {
            showLoading(true);
            await makeAPIRequest('MoveCompanionItem', [SESSION_ID, itemId, companionIndex, -1, -1]);
            await loadAllInventoryData();
            showLoading(false);
        }

        // Pomocné funkcie
        function removeTooltips() { document.querySelectorAll('.tooltip').forEach(tooltip => tooltip.remove()); }
        function removeContextMenus() { document.querySelectorAll('.context-menu').forEach(menu => menu.remove()); }
        function showLoading(show) {
            const loading = document.querySelector('.loading');
            if (loading) loading.style.display = show ? 'flex' : 'none';
        }

        // Pridanie tlačidla pre otvorenie inventára s možnosťou presunu
        function addInventoryButton() {
            const button = document.createElement('button');
            button.textContent = 'Rozšírený inventár';
            button.id = 'tanoth-inventory-button';
            
            // Načítanie poslednej pozície z localStorage alebo predvolené hodnoty
            const savedPosition = JSON.parse(localStorage.getItem('tanothInventoryButtonPosition') || '{"top": 20, "right": 20}');
            
            button.style.cssText = `
                position: fixed; top: ${savedPosition.top}px; right: ${savedPosition.right}px; z-index: 9999;
                background: linear-gradient(145deg, #f39c12, #e67e22); border: none;
                color: white; padding: 12px 20px; border-radius: 8px; cursor: grab;
                font-weight: bold; box-shadow: 0 4px 15px rgba(243, 156, 18, 0.4);
                transition: all 0.2s ease; user-select: none;
            `;

            let isDragging = false;
            let startX, startY, initialRight, initialTop;

            // Hover efekty
            button.addEventListener('mouseenter', () => {
                if (!isDragging) button.style.transform = 'translateY(-2px)';
            });
            button.addEventListener('mouseleave', () => {
                if (!isDragging) button.style.transform = 'translateY(0)';
            });

            // Drag functionality
            button.addEventListener('mousedown', (e) => {
                isDragging = true;
                button.style.cursor = 'grabbing';
                button.style.transform = 'translateY(0)';
                
                // Získaj aktuálnu pozíciu
                const rect = button.getBoundingClientRect();
                initialTop = rect.top;
                initialRight = window.innerWidth - rect.right;
                
                startX = e.clientX;
                startY = e.clientY;

                e.preventDefault(); // Zabráni výberu textu

                // Pridaj event listenery pre pohyb a uvoľnenie
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
            });

            function handleMouseMove(e) {
                if (!isDragging) return;

                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;

                const newTop = Math.max(0, Math.min(window.innerHeight - button.offsetHeight, initialTop + deltaY));
                const newRight = Math.max(0, Math.min(window.innerWidth - button.offsetWidth, initialRight - deltaX));

                button.style.top = newTop + 'px';
                button.style.right = newRight + 'px';
            }

            function handleMouseUp(e) {
                if (!isDragging) return;
                
                isDragging = false;
                button.style.cursor = 'grab';

                // Uloženie pozície do localStorage
                const rect = button.getBoundingClientRect();
                const position = {
                    top: rect.top,
                    right: window.innerWidth - rect.right
                };
                localStorage.setItem('tanothInventoryButtonPosition', JSON.stringify(position));

                // Odstránenie event listenerov
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);

                // Ak sa tlačidlo nepresunulo veľmi (malý pohyb), otvor inventár
                const deltaX = Math.abs(e.clientX - startX);
                const deltaY = Math.abs(e.clientY - startY);
                if (deltaX < 5 && deltaY < 5) {
                    createInventoryUI();
                }
            }

            // Pravý klik pre reset pozície
            button.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                
                // Reset na predvolenú pozíciu
                const defaultPosition = { top: 20, right: 20 };
                button.style.top = defaultPosition.top + 'px';
                button.style.right = defaultPosition.right + 'px';
                
                // Uloženie resetnutej pozície
                localStorage.setItem('tanothInventoryButtonPosition', JSON.stringify(defaultPosition));
                
                // Krátky vizuálny feedback
                const originalShadow = button.style.boxShadow;
                button.style.boxShadow = '0 4px 15px rgba(46, 204, 113, 0.6)';
                setTimeout(() => {
                    button.style.boxShadow = originalShadow;
                }, 300);
            });

            // Tooltip pre informáciu o presune
            button.title = 'Ľavý klik: Otvoriť inventár\nŤahanie: Presunúť tlačidlo\nPravý klik: Reset pozície';

            document.body.appendChild(button);
        }

        // 🔥 INICIALIZÁCIA: NAČÍTAJ RÚNY NAJPRV, POTOM UI
        async function init() {
            await loadRuneBonus();
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', addInventoryButton);
            } else {
                addInventoryButton();
            }
        }

        // SPUSTENIE
        init();

    })();
});
document.addEventListener('DOMContentLoaded', () => {
    const form = document.querySelector('[data-search-form]');
    const input = document.querySelector('#q');
    const status = document.querySelector('[data-status]');
    const resultBox = document.querySelector('[data-results]');
    const touristList = document.getElementById('tourist-list');
    const routeStatus = document.getElementById('route-status');
    const routeInfo = document.getElementById('route-info');
    const routeLines = document.getElementById('route-lines');
    const placeOptions = document.getElementById('place-options');
    const touristSearchList = document.getElementById('tourist-search-list');
    const terminalLocation = { lat: -23.2838223082466, lng: -47.675728164247964 };
    let places = [];
    let touristPoints = [];
    let busStops = [];
    let map;
    let routeLayer;

    function normalize(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('pt-BR')
            .trim();
    }

    function validCoordinates(latitude, longitude) {
        return Number.isFinite(latitude) && Number.isFinite(longitude)
            && latitude !== 0 && longitude !== 0;
    }

    function initializeMap() {
        if (!window.L || !document.getElementById('tourist-map')) return;
        map = L.map('tourist-map', { keyboard: true }).setView([terminalLocation.lat, terminalLocation.lng], 13);
        L.tileLayer('https://tile.openstreetmap.de/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap contributors &copy; OSM DE',
            maxZoom: 19,
        }).addTo(map);
        L.marker([terminalLocation.lat, terminalLocation.lng])
            .addTo(map)
            .bindPopup('Rodoviária de Boituva');
        routeLayer = L.layerGroup().addTo(map);
    }

    function buildPlaces(rawPlaces, rawTourists) {
        const indexed = new Map();
        rawPlaces.forEach((place) => {
            const latitude = Number(place.lat);
            const longitude = Number(place.lng);
            if (!place.nome || !validCoordinates(latitude, longitude)) return;
            const item = {
                nome: place.nome,
                endereco: place.endereco || '',
                latitude,
                longitude,
                turistico: false,
            };
            indexed.set(normalize(item.nome), item);
        });
        rawTourists.forEach((place) => {
            const nome = place['Ponto Turístico'] || place.nome || 'Local turístico';
            const latitude = Number(place.lat);
            const longitude = Number(place.lon);
            if (!validCoordinates(latitude, longitude)) return;
            const key = normalize(nome);
            const current = indexed.get(key) || {};
            indexed.set(key, {
                ...current,
                nome,
                endereco: place['Endereço'] || place.endereco || current.endereco || '',
                latitude,
                longitude,
                turistico: true,
                descricao: place.Descrição || '',
            });
        });
        return [...indexed.values()].sort((left, right) => left.nome.localeCompare(right.nome, 'pt-BR'));
    }

    function buildBusStops(rawStops) {
        return Object.entries(rawStops).flatMap(([address, info]) => {
            if (!Array.isArray(info) || !Array.isArray(info[0]) || info.length < 3) return [];
            const latitude = Number(info[1].latitude);
            const longitude = Number(info[2].longitude);
            if (!validCoordinates(latitude, longitude)) return [];
            return [{
                endereco: address.replace(/^"|[",]+$/g, '').trim(),
                latitude,
                longitude,
                codigos: info[0].map(String),
            }];
        });
    }

    function populateSuggestions(query = '') {
        const term = normalize(query);
        if (term.length < 3) {
            placeOptions.replaceChildren();
            return;
        }
        const matches = touristPoints.filter((point) => normalize(point.nome).startsWith(term)).slice(0, 40);
        placeOptions.replaceChildren();
        matches.forEach((point) => {
            const option = document.createElement('option');
            option.value = point.nome;
            placeOptions.appendChild(option);
        });
    }

    function renderTouristSearchList(query = '') {
        const term = normalize(query);
        touristSearchList.replaceChildren();
        if (term.length < 3) {
            return;
        }
        const visiblePoints = touristPoints.filter((point) => normalize(point.nome).startsWith(term));
        if (!visiblePoints.length) {
            addText(touristSearchList, 'li', 'Nenhum ponto turístico corresponde à busca.');
            return;
        }
        visiblePoints.forEach((point) => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = point.nome;
            button.addEventListener('click', () => {
                input.value = point.nome;
                form.requestSubmit();
            });
            item.appendChild(button);
            touristSearchList.appendChild(item);
        });
    }

    function renderTouristList() {
        touristList.replaceChildren();
        if (!touristPoints.length) {
            const empty = document.createElement('li');
            empty.textContent = 'Nenhum ponto turístico encontrado.';
            touristList.appendChild(empty);
            return;
        }
        touristPoints.forEach((point) => {
            const item = document.createElement('li');
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = point.nome;
            button.setAttribute('aria-label', `Mostrar rota para ${point.nome}`);
            button.addEventListener('click', () => {
                updateSelection(point);
            });
            item.appendChild(button);
            touristList.appendChild(item);
        });
    }

    function haversineKm(first, second) {
        const radians = (degrees) => degrees * Math.PI / 180;
        const latitudeDelta = radians(second.latitude - first.latitude);
        const longitudeDelta = radians(second.longitude - first.longitude);
        const firstLatitude = radians(first.latitude);
        const secondLatitude = radians(second.latitude);
        const value = Math.sin(latitudeDelta / 2) ** 2
            + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
        return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
    }

    function nearestTo(place, candidates) {
        let nearest = null;
        candidates.forEach((candidate) => {
            const distance = haversineKm(place, candidate);
            if (!nearest || distance < nearest.distanceKm) nearest = { ...candidate, distanceKm: distance };
        });
        return nearest;
    }

    function findPlace(query) {
        const term = normalize(query);
        const matching = places.filter((place) => normalize(place.nome).startsWith(term));
        return matching.find((place) => normalize(place.nome) === term)
            || matching[0]
            || null;
    }

    function addText(parent, tagName, text, className = '') {
        const element = document.createElement(tagName);
        element.textContent = text;
        if (className) element.className = className;
        parent.appendChild(element);
        return element;
    }

    function renderSearchResult(place) {
        resultBox.replaceChildren();
        const card = document.createElement('article');
        card.className = 'result-card';
        addText(card, 'h3', `Destino: ${place.nome}`);
        addText(card, 'p', `Endereço: ${place.endereco || 'Não informado'}`);
        card.appendChild(Object.assign(document.createElement('div'), { className: 'divider' }));

        const landmark = nearestTo(place, touristPoints.filter((point) => normalize(point.nome) !== normalize(place.nome)));
        addText(card, 'h4', 'Marco referencial mais próximo');
        addText(card, 'p', landmark
            ? `${landmark.nome} - ${Math.round(landmark.distanceKm * 1000)} m`
            : 'Nenhum marco encontrado.');

        const stop = nearestTo(place, busStops);
        addText(card, 'h4', 'Ponto de ônibus mais próximo');
        if (!stop) {
            addText(card, 'p', 'Nenhum ponto com coordenadas encontrado.');
        } else {
            addText(card, 'p', `${stop.endereco} - ${Math.round(stop.distanceKm * 1000)} m`);
            const list = document.createElement('ul');
            list.className = 'route-list';
            if (stop.codigos.length) {
                stop.codigos.forEach((code) => {
                    const routeName = window.busRouteNames[code];
                    addText(list, 'li', routeName ? `${code} - ${routeName}` : code);
                });
            } else {
                addText(list, 'li', 'Sem linhas cadastradas.');
            }
            card.appendChild(list);
        }
        resultBox.appendChild(card);
    }

    function updateSelection(place) {
        renderSearchResult(place);
        if (place && place.turistico) {
            showRoute(place);
        } else {
            routeInfo.classList.remove('visible');
            routeStatus.textContent = place
                ? `Local encontrado: ${place.nome}. Selecione um ponto turístico para traçar a rota.`
                : 'Escolha um ponto turístico no painel para traçar a rota.';
        }
    }

    function renderLineBadges(codes) {
        routeLines.replaceChildren();
        const lines = [...new Set(codes)].filter(Boolean);
        routeInfo.classList.add('visible');
        if (!lines.length) {
            addText(routeLines, 'span', 'Sem linhas', 'route-badge');
            return;
        }
        lines.forEach((code) => {
            const routeName = window.busRouteNames[code];
            addText(routeLines, 'span', routeName ? `${code} - ${routeName}` : code, 'route-badge');
        });
    }

    function buildMarkerIcon(color) {
        return L.divIcon({
            className: 'custom-marker-pin',
            html: `<span style="background:${color};width:18px;height:18px;display:block;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px rgba(0,0,0,.15)"></span>`,
            iconSize: [18, 18],
            iconAnchor: [9, 9],
            popupAnchor: [0, -10],
        });
    }

    async function showRoute(point) {
        if (!map || !routeLayer) {
            routeStatus.textContent = 'O mapa não pôde ser carregado.';
            return;
        }
        routeStatus.textContent = `Calculando a rota até ${point.nome}...`;
        try {
            const url = new URL('https://router.project-osrm.org/route/v1/driving/'
                + `${terminalLocation.lng},${terminalLocation.lat};${point.longitude},${point.latitude}`);
            url.search = new URLSearchParams({ overview: 'full', geometries: 'geojson' });
            const response = await fetch(url);
            if (!response.ok) throw new Error('Rota indisponível no momento.');
            const data = await response.json();
            const route = data.routes && data.routes[0];
            if (!route) throw new Error('Rota não encontrada.');

            const coordinates = route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
            routeLayer.clearLayers();
            L.polyline(coordinates, {
                color: '#1d4ed8', weight: 6, opacity: 0.8, lineCap: 'round',
            }).addTo(routeLayer);
            L.marker([terminalLocation.lat, terminalLocation.lng], { icon: buildMarkerIcon('#16a34a') })
                .addTo(routeLayer)
                .bindPopup('Origem: Rodoviária de Boituva');
            L.marker([point.latitude, point.longitude], { icon: buildMarkerIcon('#dc2626') })
                .addTo(routeLayer)
                .bindPopup(`Destino: ${point.nome}`);
            map.fitBounds(L.latLngBounds(coordinates).pad(0.2));

            const nearbyStop = nearestTo(point, busStops);
            renderLineBadges(nearbyStop ? nearbyStop.codigos : []);
            const distanceKm = (route.distance / 1000).toFixed(2);
            const durationMinutes = (route.duration / 60).toFixed(1);
            routeStatus.textContent = `Rota até ${point.nome}: ${distanceKm} km, aproximadamente ${durationMinutes} min.`;
        } catch (error) {
            routeStatus.textContent = error.message || 'Não foi possível calcular a rota.';
            renderLineBadges([]);
        }
    }

    input.addEventListener('input', () => {
        populateSuggestions(input.value);
        renderTouristSearchList(input.value);
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        status.hidden = false;
        const query = input.value.trim();
        if (!query) {
            status.textContent = 'Digite um local para buscar.';
            return;
        }
        const place = findPlace(query);
        if (!place) {
            resultBox.replaceChildren();
            addText(resultBox, 'p', 'Nenhum local encontrado nos dados disponíveis.', 'result-card');
            status.textContent = 'Busca concluída.';
            return;
        }
        updateSelection(place);
        status.textContent = 'Busca concluída com dados locais.';
    });

    initializeMap();
    const staticData = window.STATIC_DATA;
    if (!staticData) {
        status.textContent = 'Não foi possível carregar os dados. Verifique os arquivos publicados.';
        touristList.replaceChildren();
        addText(touristList, 'li', 'Dados locais indisponíveis.');
        return;
    }

    window.busRouteNames = staticData.routeNames;
    places = buildPlaces(staticData.places, staticData.tourists);
    touristPoints = places.filter((place) => place.turistico);
    busStops = buildBusStops(staticData.stops);
    populateSuggestions();
    renderTouristList();
    renderTouristSearchList();
    status.hidden = true;
});
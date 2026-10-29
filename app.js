/**
 * Виртуальный лабораторный комплекс «Микроклимат» (Республика Казахстан)
 * v4.5 — Полный каталог 12 мер защиты и связанные рекомендации
 * Нормативная база: ГОСТ 12.1.005-88, Приказ МЗ РК № ҚР ДСМ-15, ТК РК ст. 82, 182, 184
 */

(function () {
    // ═══════════════════ СОСТОЯНИЕ (STATE) ═══════════════════
    const state = {
        selectedPresetId: 'preset-1',
        category: 'Ia',
        season: 'warm',
        pressureHpa: 1013.25, // Стандартное атмосферное давление (гПа)

        // Исходные параметры помещения (базовые)
        rawTempDry: 27.2,
        rawTempWet: 22.0,
        rawAnemometerDelta: 1,
        rawRadiation: 15,

        // 12 инженерно-технических и организационных мер (ТК РК ст. 184)
        measures: {
            ventilation: false,   // Мера 1: Общеобменная вентиляция
            curtain: false,       // Мера 2: Воздушно-тепловая завеса
            ac: false,            // Мера 3: Кондиционирование
            air_shower: false,    // Мера 4: Воздушное душирование
            heating: false,       // Мера 5: Инфракрасный обогрев
            insulation: false,    // Мера 6: Теплоизоляция оборудования
            humidifier: false,    // Мера 7: Увлажнитель воздуха
            dehumidifier: false,  // Мера 8: Осушитель воздуха
            baffles: false,       // Мера 9: Ветрозащитные экраны и диффузоры
            screen: false,        // Мера 10: Теплозащитный экран
            cabin: false,         // Мера 11: Кабина с климат-контролем
            breaks: false         // Мера 12: Регламентированные перерывы
        },

        currentMeasuresFilter: 'all',

        // Состояние приборов
        instruments: {
            aspiratorRunning: false,
            aspiratorTimer: null,
            aspiratorSecondsLeft: 0,
            anemometerRunning: false,
            anemometerTimer: null,
            anemometerSecondsLeft: 0,
            anemometerStartCount: 1240,
            anemometerCurrentCount: 1240,
            anemometerDuration: 20
        },

        // Графики Chart.js
        charts: {
            barChart: null,
            comfortChart: null
        },

        // Журнал замеров (localStorage)
        history: [],

        // Флаг разворота панели формулы
        formulaExpanded: false
    };

    // ═══════════════════ МАТЕМАТИКА И ФИЗИКА ═══════════════════

    /**
     * Давление насыщенного водяного пара (гПа) по формуле Магнуса-Тетенса
     */
    function calcSatVaporPressure(tempC) {
        return 6.112 * Math.exp((17.67 * tempC) / (tempC + 243.5));
    }

    /**
     * Расчет параметров по психрометрической формуле Шпрунга для аспирационного психрометра Ассмана
     * e = E_wet - A * P * (t_dry - t_wet)
     * phi = (e / E_dry) * 100%
     */
    function calcPsychrometer(tDry, tWet, pressure = 1013.25) {
        const A = 0.000662;
        const eWet = calcSatVaporPressure(tWet);
        const eDry = calcSatVaporPressure(tDry);
        const deltaT = tDry - tWet;

        let e = eWet - A * pressure * deltaT;
        if (e < 0) e = 0;

        let rh = (e / eDry) * 100;
        rh = Math.max(5, Math.min(100, rh));

        return {
            eDry: parseFloat(eDry.toFixed(2)),
            eWet: parseFloat(eWet.toFixed(2)),
            actualVaporPressure: parseFloat(e.toFixed(2)),
            relativeHumidity: parseFloat(rh.toFixed(1)),
            psychrometricDiff: parseFloat(deltaT.toFixed(1)),
            A: A,
            pressure: pressure
        };
    }

    /**
     * Расчет скорости движения воздуха по крыльчатому анемометру АСО-3 (ГОСТ 12.1.005-88)
     */
    function calcAnemometer(deltaN, durationSec = 20) {
        const nSec = durationSec > 0 ? deltaN / durationSec : 0;
        let v;
        if (nSec <= 0.05) v = 0.05;
        else if (nSec <= 1.0) v = 0.10 + 0.85 * nSec;
        else v = 0.15 + 0.80 * nSec;

        return {
            deltaN: Math.round(deltaN),
            nSec: parseFloat(nSec.toFixed(2)),
            velocity: parseFloat(v.toFixed(2))
        };
    }

    /**
     * Расчет радиационной температуры и индекса ТНС (WBGT)
     */
    function calcRadiation(tDry, tWet, v, radFlux) {
        const tg = tDry + (0.018 * radFlux) / (1 + 0.4 * Math.sqrt(v));
        const tns = 0.7 * tWet + 0.3 * tg;
        return {
            tGlobe: parseFloat(tg.toFixed(1)),
            tnsIndex: parseFloat(tns.toFixed(1)),
            flux: Math.round(radFlux)
        };
    }

    /**
     * Эффективные параметры с учетом включенных мер защиты (12 мер)
     */
    function getEffectiveEnvironment() {
        let tDry = state.rawTempDry;
        let tWet = state.rawTempWet;
        let deltaN = state.rawAnemometerDelta;
        let rad = state.rawRadiation;

        // Мера 11: Кабина оператора с климат-контролем (полный оверрайд)
        if (state.measures.cabin) {
            tDry = 23.0;
            tWet = 17.2;
            rad = 0;
            deltaN = 1;
        } else {
            // Мера 1: Общеобменная вентиляция с рекуперацией (ГОСТ 12.1.005-88 п. 1.5)
            if (state.measures.ventilation) {
                if (tDry > 24) tDry -= 2.5;
                if (tDry < 18) tDry += 2.5;
                deltaN = Math.max(2, Math.min(5, deltaN)); // 0.15–0.25 м/с
            }

            // Мера 2: Воздушно-тепловая завеса ворот
            if (state.measures.curtain) {
                if (state.season === 'cold') {
                    tDry += 3.5;
                    deltaN = Math.max(1, deltaN - 55); // Снижает сквозняк
                }
            }

            // Мера 3: Кондиционирование воздуха (ст. 184 ТК РК)
            if (state.measures.ac) {
                if (tDry > 23) {
                    tDry = Math.max(23.0, tDry - 4.0);
                    tWet = Math.max(17.0, tWet - 5.0);
                }
            }

            // Мера 4: Воздушное душирование (локальное охлаждение)
            if (state.measures.air_shower) {
                tDry = Math.max(21.0, tDry - 3.5);
                tWet = Math.max(16.0, tWet - 2.5);
                deltaN = Math.max(4, deltaN); // Поток воздуха в зоне дыхания
            }

            // Мера 5: Инфракрасный обогрев
            if (state.measures.heating) {
                if (state.season === 'cold') {
                    tDry += 4.5;
                    tWet += 2.0;
                }
            }

            // Мера 6: Теплоизоляция горячего оборудования
            if (state.measures.insulation) {
                tDry -= 2.0;
                rad = Math.round(rad * 0.6); // Снижение излучения на 40%
            }

            // Мера 7: Промышленный увлажнитель воздуха
            if (state.measures.humidifier) {
                const diff = tDry - tWet;
                tWet += diff * 0.45; // Повышает влажность
            }

            // Мера 8: Промышленный осушитель воздуха
            if (state.measures.dehumidifier) {
                tWet = Math.max(tDry - 10, tWet - 4.5); // Снижает влажность
            }

            // Мера 9: Ветрозащитные экраны и диффузоры
            if (state.measures.baffles) {
                deltaN = Math.min(deltaN, 2); // Снижает скорость до ≤ 0.15 м/с
            }

            // Мера 10: Теплозащитный водоохлаждаемый экран
            if (state.measures.screen) {
                rad = Math.round(rad * 0.15); // Задерживает 85% лучистого тепла
                tDry -= 2.0;
            }
        }

        // Защита от физического несоответствия (tWet <= tDry)
        if (tWet > tDry) tWet = tDry;

        const anem = calcAnemometer(deltaN, state.instruments.anemometerDuration);
        const psych = calcPsychrometer(tDry, tWet, state.pressureHpa);
        const radRes = calcRadiation(tDry, tWet, anem.velocity, rad);

        return {
            tDry: parseFloat(tDry.toFixed(1)),
            tWet: parseFloat(tWet.toFixed(1)),
            rh: psych.relativeHumidity,
            velocity: anem.velocity,
            radiation: radRes.flux,
            tGlobe: radRes.tGlobe,
            tnsIndex: radRes.tnsIndex,
            psych: psych,
            anem: anem
        };
    }

    // ═══════════════════ ЭКСПЕРТНАЯ ОЦЕНКА ПО ГОСТ 12.1.005-88 / РК ═══════════════════

    function evaluateSanPiN(env) {
        const seasonNorms = SANPIN_DATA.norms[state.season] || SANPIN_DATA.norms['warm'];
        const norm = seasonNorms[state.category] || seasonNorms['Ia'];
        const opt = norm.optimal;
        const perm = norm.permissible;

        // 1. Температура воздуха
        let tStatus = 'optimal', tDiff = 0;
        if (env.tDry < perm.tMin) {
            tStatus = 'harmful_low';
            tDiff = perm.tMin - env.tDry;
        } else if (env.tDry > perm.tMax) {
            tStatus = 'harmful_high';
            tDiff = env.tDry - perm.tMax;
        } else if (env.tDry < opt.tMin || env.tDry > opt.tMax) {
            tStatus = 'permissible';
        }

        // 2. Относительная влажность
        let rhStatus = 'optimal';
        if (env.rh < perm.rhMin) rhStatus = 'harmful_low';
        else if (env.rh > perm.rhMax) rhStatus = 'harmful_high';
        else if (env.rh < opt.rhMin || env.rh > opt.rhMax) rhStatus = 'permissible';

        // 3. Скорость движения воздуха
        let vStatus = 'optimal';
        if (env.velocity > perm.vMax) vStatus = 'harmful_high';
        else if (env.velocity < 0.05 && opt.vMax >= 0.1) vStatus = 'permissible_low';
        else if (env.velocity > opt.vMax) vStatus = 'permissible';

        // 4. Тепловое облучение (ГОСТ 12.1.005-88 п. 1.4)
        let radStatus = 'optimal';
        if (env.radiation > SANPIN_DATA.radiationNorms.withPPE) {
            radStatus = 'harmful_high';
        } else if (env.radiation > SANPIN_DATA.radiationNorms.maxPermissible) {
            radStatus = 'permissible_with_ppe';
        }

        // Определение класса условий труда
        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';
        let workClass = (lang === 'kz') ? '1 (Оңтайлы)' : '1 (Оптимальный)';
        let classBadge = 'badge-success';
        let classScore = 1;
        let reasons = [];

        const isHarmful = (tStatus.startsWith('harmful') || rhStatus.startsWith('harmful') || vStatus === 'harmful_high' || radStatus === 'harmful_high');
        const isPermissible = (tStatus === 'permissible' || rhStatus === 'permissible' || vStatus === 'permissible' || vStatus === 'permissible_low' || radStatus === 'permissible_with_ppe');

        if (isHarmful) {
            if (tDiff > 4.0 || env.radiation > 600) {
                classScore = 3.3;
                workClass = (lang === 'kz') ? '3.3 (Зиянды 3° — жоғары қауіп)' : '3.3 (Вредный 3° — повышенная опасность)';
                classBadge = 'badge-danger';
            } else if (tDiff > 2.0 || env.radiation > 350) {
                classScore = 3.2;
                workClass = (lang === 'kz') ? '3.2 (Зиянды 2° — қалыпты қауіп)' : '3.2 (Вредный 2° — умеренная опасность)';
                classBadge = 'badge-danger';
            } else {
                classScore = 3.1;
                workClass = (lang === 'kz') ? '3.1 (Зиянды 1° — бастапқы зияндылық)' : '3.1 (Вредный 1° — начальная вредность)';
                classBadge = 'badge-warning-dark';
            }

            // Мера 12: Регламентированные перерывы (ст. 82 ТК РК) снижает вредность на 1 ступень!
            if (state.measures.breaks) {
                if (classScore === 3.3) {
                    classScore = 3.2;
                    workClass = (lang === 'kz') ? '3.2 (Зиянды 2° — үзілістерді ескере отырып)' : '3.2 (Вредный 2° — с учётом регламентированных перерывов)';
                    classBadge = 'badge-danger';
                } else if (classScore === 3.2) {
                    classScore = 3.1;
                    workClass = (lang === 'kz') ? '3.1 (Зиянды 1° — үзілістерді ескере отырып)' : '3.1 (Вредный 1° — с учётом регламентированных перерывов)';
                    classBadge = 'badge-warning-dark';
                } else if (classScore === 3.1) {
                    classScore = 2;
                    workClass = (lang === 'kz') ? '2 (Рұқсат етілген — үзілістер арқасында)' : '2 (Допустимый — благодаря регламентированным перерывам)';
                    classBadge = 'badge-warning';
                }
            }

            if (lang === 'kz') {
                if (tStatus === 'harmful_low') reasons.push(`Температура (${env.tDry} °C) рұқсат етілген нормадан (${perm.tMin} °C) төмен — тоңып қалу қаупі`);
                if (tStatus === 'harmful_high') reasons.push(`Температура (${env.tDry} °C) рұқсат етілген нормадан (${perm.tMax} °C) асады — қызып кету қаупі`);
                if (rhStatus === 'harmful_low') reasons.push(`Ылғалдылық (${env.rh}%) рұқсат етілген шектен (${perm.rhMin}%) төмен — тыныс алу жолдарының кебуі`);
                if (rhStatus === 'harmful_high') reasons.push(`Ылғалдылық (${env.rh}%) рұқсат етілген шектен (${perm.rhMax}%) асады — термен жылу бөлу қиындаған`);
                if (vStatus === 'harmful_high') reasons.push(`Ауа жылдамдығы (${env.velocity} м/с) рұқсат етілгеннен (${perm.vMax} м/с) жоғары — жел өті (сым)`);
                if (radStatus === 'harmful_high') reasons.push(`Жылулық сәулелену (${env.radiation} Вт/м²) арнайы киімді қолдану шегінен (350 Вт/м²) асады`);
                if (state.measures.breaks) reasons.push(`Ұйымдастырушылық шара (ҚР ЕК 82-бабы бойынша үзілістер) жылу жүктемесін 1 зияндылық класына төмендетеді.`);
            } else {
                if (tStatus === 'harmful_low') reasons.push(`Температура (${env.tDry} °C) ниже допустимой нормы (${perm.tMin} °C) — риск переохлаждения организма`);
                if (tStatus === 'harmful_high') reasons.push(`Температура (${env.tDry} °C) превышает допустимую норму (${perm.tMax} °C) — риск теплового перегрева`);
                if (rhStatus === 'harmful_low') reasons.push(`Влажность (${env.rh}%) ниже допустимого предела (${perm.rhMin}%) — пересыхание слизистых дыхательных путей`);
                if (rhStatus === 'harmful_high') reasons.push(`Влажность (${env.rh}%) превышает допустимый предел (${perm.rhMax}%) — затруднена теплоотдача испарением`);
                if (vStatus === 'harmful_high') reasons.push(`Скорость воздуха (${env.velocity} м/с) превышает допустимую (${perm.vMax} м/с) — сквозняк`);
                if (radStatus === 'harmful_high') reasons.push(`Тепловое облучение (${env.radiation} Вт/м²) превышает порог применения спецодежды (350 Вт/м²)`);
                if (state.measures.breaks) reasons.push(`Организационная мера (перерывы по ст. 82 ТК РК) компенсирует тепловую нагрузку на 1 класс вредности.`);
            }
        } else if (isPermissible) {
            workClass = (lang === 'kz') ? '2 (Рұқсат етілген)' : '2 (Допустимый)';
            classBadge = 'badge-warning';
            classScore = 2;

            if (lang === 'kz') {
                if (tStatus === 'permissible') reasons.push(`Температура (${env.tDry} °C) рұқсат етілген шекте (${perm.tMin}–${perm.tMax} °C), бірақ оңтайлы мәннен (${opt.tMin}–${opt.tMax} °C) тыс`);
                if (rhStatus === 'permissible') reasons.push(`Ылғалдылық (${env.rh}%) рұқсат етілген, бірақ оңтайлы мәннен (${opt.rhMin}–${opt.rhMax}%) ауытқиды`);
                if (vStatus === 'permissible') reasons.push(`Ауа жылдамдығы (${env.velocity} м/с) оңтайлы мәннен (${opt.vMax} м/с) жоғары`);
                if (vStatus === 'permissible_low') reasons.push(`Ауа жылдамдығы (${env.velocity} м/с) өте төмен: жұмыс аймағында ауа тоқырауы`);
                if (radStatus === 'permissible_with_ppe') reasons.push(`Жылулық сәулелену (${env.radiation} Вт/м²): бет пен көзді қорғайтын ЖҚҚ міндетті (МЕМСТ 1.4-т.)`);
            } else {
                if (tStatus === 'permissible') reasons.push(`Температура (${env.tDry} °C) в допустимых пределах (${perm.tMin}–${perm.tMax} °C), но вне оптимума (${opt.tMin}–${opt.tMax} °C)`);
                if (rhStatus === 'permissible') reasons.push(`Влажность (${env.rh}%) допустима, но отклоняется от оптимального диапазона (${opt.rhMin}–${opt.rhMax}%)`);
                if (vStatus === 'permissible') reasons.push(`Скорость воздуха (${env.velocity} м/с) выше оптимальной (${opt.vMax} м/с)`);
                if (vStatus === 'permissible_low') reasons.push(`Скорость воздуха (${env.velocity} м/с) очень низкая: застой воздуха в рабочей зоне`);
                if (radStatus === 'permissible_with_ppe') reasons.push(`Тепловое облучение (${env.radiation} Вт/м²): обязательно применение СИЗ лица и глаз (п. 1.4 ГОСТ)`);
            }
        } else {
            reasons.push((lang === 'kz') ? 'Микроклиматтың барлық параметрлері МЕМСТ 12.1.005-88 (ҚР) оңтайлы нормаларына толық сәйкес келеді.' : 'Все параметры микроклимата строго соответствуют оптимальным нормам ГОСТ 12.1.005-88 (РК).');
        }

        return { norm, tStatus, rhStatus, vStatus, radStatus, workClass, classBadge, classScore, reasons };
    }

    // ═══════════════════ ДИНАМИЧЕСКИЙ РЕНДЕР КАТАЛОГА МЕР ═══════════════════

    function renderMeasuresList(filter = 'all') {
        const grid = document.getElementById('measuresGrid');
        if (!grid) return;

        state.currentMeasuresFilter = filter;
        const catalog = SANPIN_DATA.measuresCatalog;
        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';

        const filteredKeys = Object.keys(catalog).filter(key => {
            if (filter === 'all') return true;
            const item = catalog[key];
            if (filter === 'temp' && (item.category === 'temp' || key === 'insulation' || key === 'cabin')) return true;
            if (filter === 'velocity' && (item.category === 'velocity' || item.category === 'air')) return true;
            if (filter === 'humidity' && item.category === 'humidity') return true;
            if (filter === 'radiation' && (item.category === 'radiation' || key === 'cabin')) return true;
            if (filter === 'organizational' && item.category === 'organizational') return true;
            return false;
        });

        grid.innerHTML = filteredKeys.map(key => {
            const m = catalog[key];
            let mTitle = m.title;
            let mCatName = m.categoryName;
            let mDesc = m.description;
            let mLaw = m.law;
            let mEffects = m.effects;

            if (typeof I18N !== 'undefined' && I18N.data && I18N.data.measures && I18N.data.measures[key]) {
                const tr = I18N.data.measures[key][lang];
                if (tr) {
                    mTitle = tr.title || mTitle;
                    mCatName = tr.categoryName || mCatName;
                    mDesc = tr.description || mDesc;
                    mLaw = tr.law || mLaw;
                    mEffects = tr.effects || mEffects;
                }
            }

            const isChecked = state.measures[key] ? 'checked' : '';
            const catClass = `measure-cat-${m.category}`;
            const numLabel = (typeof I18N !== 'undefined') ? I18N.t('measureLabelNumber', { num: m.number }) : `№${m.number}`;

            return `
                <label class="measure-tile" data-measure-id="${m.id}">
                    <input type="checkbox" id="measure_${m.id}" data-id="${m.id}" ${isChecked}>
                    <div class="measure-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            ${m.iconSvg}
                        </svg>
                    </div>
                    <div class="measure-info">
                        <div>
                            <span class="measure-num">${numLabel}</span>
                            <span class="measure-cat-tag ${catClass}">${mCatName}</span>
                        </div>
                        <h4>${mTitle}</h4>
                        <p>${mDesc}</p>
                        <div class="measure-effects">
                            ${mEffects.map(eff => `<span class="effect-tag">${eff}</span>`).join('')}
                        </div>
                        <div class="measure-law-cite">${mLaw}</div>
                    </div>
                </label>
            `;
        }).join('');

        // Обработчики переключения чекбоксов
        grid.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const mId = e.target.dataset.id;
                state.measures[mId] = e.target.checked;
                const m = catalog[mId];
                let mTitle = m.title;
                if (typeof I18N !== 'undefined' && I18N.data && I18N.data.measures && I18N.data.measures[mId]) {
                    const tr = I18N.data.measures[mId][lang];
                    if (tr && tr.title) mTitle = tr.title;
                }

                if (e.target.checked) {
                    showToast(I18N.t('toastMeasureOn', { num: m.number, title: mTitle }), 'success', 2200);
                } else {
                    showToast(I18N.t('toastMeasureOff', { num: m.number }), 'info', 1800);
                }
                updateAll();
            });
        });
    }

    // ═══════════════════ РЕКОМЕНДАЦИИ СО ССЫЛКАМИ НА СУЩЕСТВУЮЩИЕ МЕРЫ ═══════════════════

    function renderRecommendations(evalRes) {
        const panel = document.getElementById('recommendationsPanel');
        if (!panel) return;

        const catalog = SANPIN_DATA.measuresCatalog;
        const recList = [];
        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';

        // Анализ отклонений и подбор адресных рекомендаций
        if (evalRes.tStatus === 'harmful_high' || (evalRes.tStatus === 'permissible' && evalRes.classScore >= 2)) {
            recList.push({ key: 'temp_high', rec: SANPIN_DATA.recommendations.temp_high });
        }
        if (evalRes.tStatus === 'harmful_low') {
            recList.push({ key: 'temp_low', rec: SANPIN_DATA.recommendations.temp_low });
        }
        if (evalRes.rhStatus === 'harmful_high') {
            recList.push({ key: 'rh_high', rec: SANPIN_DATA.recommendations.rh_high });
        }
        if (evalRes.rhStatus === 'harmful_low' || (evalRes.rhStatus === 'permissible')) {
            recList.push({ key: 'rh_low', rec: SANPIN_DATA.recommendations.rh_low });
        }
        if (evalRes.vStatus === 'harmful_high') {
            recList.push({ key: 'v_high', rec: SANPIN_DATA.recommendations.v_high });
        }
        if (evalRes.vStatus === 'permissible_low') {
            recList.push({ key: 'v_low', rec: SANPIN_DATA.recommendations.v_low });
        }
        if (evalRes.radStatus === 'harmful_high' || evalRes.radStatus === 'permissible_with_ppe') {
            recList.push({ key: 'radiation_high', rec: SANPIN_DATA.recommendations.radiation_high });
        }

        if (recList.length === 0) {
            panel.innerHTML = `
                <div class="alert alert-success" style="margin-top: 1.25rem;">
                    <strong>${I18N.t('recNormalAlert')}</strong>
                </div>
            `;
            return;
        }

        panel.innerHTML = `
            <h3 class="eval-reasons-title" style="margin-top: 1.25rem;">${I18N.t('recComplexTitle')}</h3>
            ${recList.map(item => {
                const rec = item.rec;
                const recKey = item.key;

                let badgeClass = 'rec-priority-medium';
                let badgeText = I18N.t('priorityMedium');
                if (rec.priority === 'critical') { badgeClass = 'rec-priority-critical'; badgeText = I18N.t('priorityCritical'); }
                else if (rec.priority === 'high') { badgeClass = 'rec-priority-high'; badgeText = I18N.t('priorityHigh'); }

                let recTitle = rec.title;
                let recLegal = rec.legal;
                let recActions = rec.actions;

                if (typeof I18N !== 'undefined' && I18N.data && I18N.data.recommendations && I18N.data.recommendations[recKey]) {
                    const tr = I18N.data.recommendations[recKey][lang];
                    if (tr) {
                        recTitle = tr.title || recTitle;
                        recLegal = tr.legal || recLegal;
                        recActions = tr.actions || recActions;
                    }
                }

                // Формирование интерактивных кнопок для конкретных мер
                const measureButtons = rec.measureIds.map(mId => {
                    const m = catalog[mId];
                    if (!m) return '';
                    let mTitle = m.title;
                    let mDesc = m.description;
                    if (typeof I18N !== 'undefined' && I18N.data && I18N.data.measures && I18N.data.measures[mId]) {
                        const trM = I18N.data.measures[mId][lang];
                        if (trM) {
                            mTitle = trM.title || mTitle;
                            mDesc = trM.description || mDesc;
                        }
                    }

                    const isActive = state.measures[mId];
                    const activeClass = isActive ? 'active' : '';
                    const icon = isActive ? '✓' : '+';
                    const text = isActive
                        ? I18N.t('btnMeasureActive', { num: m.number, title: mTitle })
                        : I18N.t('btnMeasureInactive', { num: m.number, title: mTitle });

                    return `
                        <button class="rec-measure-btn ${activeClass}" data-measure-id="${mId}" title="${mDesc}">
                            <span>${icon}</span> ${text}
                        </button>
                    `;
                }).join('');

                return `
                    <div class="rec-card">
                        <div class="rec-header-row">
                            <div class="rec-card-title">${rec.icon} ${recTitle}</div>
                            <span class="rec-priority ${badgeClass}">${badgeText}</span>
                        </div>
                        <div class="rec-legal-cite">${I18N.t('legalGround')} ${recLegal}</div>
                        <ul class="rec-list" style="margin-top: 0.5rem;">
                            ${recActions.map(act => `<li>${act}</li>`).join('')}
                        </ul>

                        <div class="rec-measures-box">
                            <div class="rec-measures-title">
                                <span>🛠️</span> ${I18N.t('recCatalogTitle')}
                            </div>
                            <div class="rec-measures-buttons">
                                ${measureButtons}
                            </div>
                        </div>
                    </div>
                `;
            }).join('')}
        `;

        // Привязка кликов к интерактивным кнопкам в блоке рекомендаций
        panel.querySelectorAll('.rec-measure-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const mId = btn.dataset.measureId;
                if (!mId) return;

                // Переключаем меру
                state.measures[mId] = !state.measures[mId];
                const m = catalog[mId];
                let mTitle = m.title;
                if (typeof I18N !== 'undefined' && I18N.data && I18N.data.measures && I18N.data.measures[mId]) {
                    const tr = I18N.data.measures[mId][lang];
                    if (tr && tr.title) mTitle = tr.title;
                }

                if (state.measures[mId]) {
                    showToast(I18N.t('toastMeasureOn', { num: m.number, title: mTitle }), 'success', 2200);
                } else {
                    showToast(I18N.t('toastMeasureOff', { num: m.number }), 'info', 1800);
                }

                // Обновляем всё состояние
                updateAll();
            });
        });
    }

    // ═══════════════════ TOAST УВЕДОМЛЕНИЯ ═══════════════════

    function showToast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `<span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }

    // ═══════════════════ PARTICLE BACKGROUND ═══════════════════

    function initParticles() {
        const canvas = document.getElementById('particleCanvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        let particles = [];
        const PARTICLE_COUNT = 38;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }
        resize();
        window.addEventListener('resize', resize);

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                r: Math.random() * 1.5 + 0.5,
                dx: (Math.random() - 0.5) * 0.3,
                dy: (Math.random() - 0.5) * 0.2,
                opacity: Math.random() * 0.3 + 0.1
            });
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            particles.forEach(p => {
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(56, 189, 248, ${p.opacity})`;
                ctx.fill();

                p.x += p.dx;
                p.y += p.dy;

                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;
            });

            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 140) {
                        ctx.beginPath();
                        ctx.strokeStyle = `rgba(56, 189, 248, ${0.05 * (1 - dist / 140)})`;
                        ctx.lineWidth = 0.5;
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(draw);
        }
        draw();
    }

    // ═══════════════════ ГРАФИКИ CHART.JS ═══════════════════

    function initCharts() {
        if (typeof Chart === 'undefined') return;

        Chart.defaults.color = '#707e7b';
        Chart.defaults.borderColor = '#dce2db';
        Chart.defaults.font.family = "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";

        initBarChart();
        initComfortChart();
    }

    function initBarChart() {
        const ctx = document.getElementById('chartBarCanvas');
        if (!ctx) return;

        const labels = (typeof I18N !== 'undefined') ? I18N.t('chartBarLabels') : ['Температура, °C', 'Влажность, %', 'Скорость, м/с ×100', 'Облучение, Вт/м²'];
        const lActual = (typeof I18N !== 'undefined') ? I18N.t('chartBarActual') : 'Фактические параметры';
        const lOpt = (typeof I18N !== 'undefined') ? I18N.t('chartBarOpt') : 'Оптимальная норма (ГОСТ РК)';
        const lPerm = (typeof I18N !== 'undefined') ? I18N.t('chartBarPerm') : 'Предельно допустимая норма';

        state.charts.barChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: lActual,
                        data: [0, 0, 0, 0],
                        backgroundColor: '#183b3c',
                        borderColor: '#183b3c',
                        borderWidth: 1.5,
                        borderRadius: 4
                    },
                    {
                        label: lOpt,
                        data: [0, 0, 0, 0],
                        backgroundColor: '#86b995',
                        borderColor: '#297263',
                        borderWidth: 1.5,
                        borderRadius: 4
                    },
                    {
                        label: lPerm,
                        data: [0, 0, 0, 0],
                        backgroundColor: '#e6c887',
                        borderColor: '#9c651b',
                        borderWidth: 1.5,
                        borderRadius: 4
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 14, padding: 12, font: { size: 11, weight: '600' }, color: '#183b3c' } },
                    tooltip: {
                        backgroundColor: '#ffffff',
                        titleColor: '#183b3c',
                        bodyColor: '#183b3c',
                        borderColor: '#dce2db',
                        borderWidth: 1,
                        cornerRadius: 6,
                        padding: 10
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(0, 0, 0, 0.05)' },
                        ticks: { font: { size: 10 }, color: '#707e7b' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { font: { size: 10 }, color: '#707e7b' }
                    }
                }
            }
        });
    }

    function initComfortChart() {
        const ctx = document.getElementById('chartComfortCanvas');
        if (!ctx) return;

        const lOpt = (typeof I18N !== 'undefined') ? I18N.t('chartComfortOpt') : 'Оптимальная зона (ГОСТ 12.1.005-88)';
        const lPerm = (typeof I18N !== 'undefined') ? I18N.t('chartComfortPerm') : 'Допустимая зона';
        const lPoint = (typeof I18N !== 'undefined') ? I18N.t('chartComfortPoint') : 'Текущие условия рабочего места';
        const axisX = (typeof I18N !== 'undefined') ? I18N.t('chartAxisTemp') : 'Температура воздуха, °C';
        const axisY = (typeof I18N !== 'undefined') ? I18N.t('chartAxisRh') : 'Относительная влажность, %';

        state.charts.comfortChart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: lOpt,
                        data: [],
                        backgroundColor: 'rgba(134, 185, 149, 0.25)',
                        borderColor: '#297263',
                        borderWidth: 2,
                        pointRadius: 0,
                        showLine: true,
                        fill: true
                    },
                    {
                        label: lPerm,
                        data: [],
                        backgroundColor: 'rgba(230, 200, 135, 0.25)',
                        borderColor: '#9c651b',
                        borderWidth: 2,
                        pointRadius: 0,
                        showLine: true,
                        fill: true
                    },
                    {
                        label: lPoint,
                        data: [{ x: 27.2, y: 64.2 }],
                        backgroundColor: '#183b3c',
                        borderColor: '#ffffff',
                        borderWidth: 2.5,
                        pointRadius: 9,
                        pointHoverRadius: 12
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { boxWidth: 14, padding: 12, font: { size: 11, weight: '600' }, color: '#183b3c' } },
                    tooltip: {
                        backgroundColor: '#ffffff',
                        titleColor: '#183b3c',
                        bodyColor: '#183b3c',
                        borderColor: '#dce2db',
                        borderWidth: 1,
                        cornerRadius: 6,
                        callbacks: {
                            label: (ctx) => `t = ${ctx.raw.x} °C, φ = ${ctx.raw.y}%`
                        }
                    }
                },
                scales: {
                    x: {
                        title: { display: true, text: axisX, font: { size: 11, weight: 600 }, color: '#183b3c' },
                        min: 10, max: 40,
                        grid: { color: 'rgba(0, 0, 0, 0.05)' },
                        ticks: { color: '#707e7b' }
                    },
                    y: {
                        title: { display: true, text: axisY, font: { size: 11, weight: 600 }, color: '#183b3c' },
                        min: 0, max: 100,
                        grid: { color: 'rgba(0, 0, 0, 0.05)' },
                        ticks: { color: '#707e7b' }
                    }
                }
            }
        });
    }

    function updateChartLanguage() {
        if (typeof I18N === 'undefined') return;
        if (state.charts.barChart) {
            const chart = state.charts.barChart;
            chart.data.labels = I18N.t('chartBarLabels');
            chart.data.datasets[0].label = I18N.t('chartBarActual');
            chart.data.datasets[1].label = I18N.t('chartBarOpt');
            chart.data.datasets[2].label = I18N.t('chartBarPerm');
            chart.update('none');
        }
        if (state.charts.comfortChart) {
            const chart = state.charts.comfortChart;
            chart.data.datasets[0].label = I18N.t('chartComfortOpt');
            chart.data.datasets[1].label = I18N.t('chartComfortPerm');
            chart.data.datasets[2].label = I18N.t('chartComfortPoint');
            chart.options.scales.x.title.text = I18N.t('chartAxisTemp');
            chart.options.scales.y.title.text = I18N.t('chartAxisRh');
            chart.update('none');
        }
    }

    function updateCharts(env, evalRes) {
        const norm = evalRes.norm;

        // Bar Chart
        if (state.charts.barChart) {
            const chart = state.charts.barChart;
            chart.data.datasets[0].data = [env.tDry, env.rh, env.velocity * 100, env.radiation];
            chart.data.datasets[1].data = [norm.optimal.tMax, norm.optimal.rhMax, norm.optimal.vMax * 100, 140];
            chart.data.datasets[2].data = [norm.permissible.tMax, norm.permissible.rhMax, norm.permissible.vMax * 100, 350];
            chart.update('none');
        }

        // Comfort Zone Chart
        if (state.charts.comfortChart) {
            const chart = state.charts.comfortChart;

            const optZone = [
                { x: norm.optimal.tMin, y: norm.optimal.rhMin },
                { x: norm.optimal.tMax, y: norm.optimal.rhMin },
                { x: norm.optimal.tMax, y: norm.optimal.rhMax },
                { x: norm.optimal.tMin, y: norm.optimal.rhMax },
                { x: norm.optimal.tMin, y: norm.optimal.rhMin }
            ];
            const permZone = [
                { x: norm.permissible.tMin, y: norm.permissible.rhMin },
                { x: norm.permissible.tMax, y: norm.permissible.rhMin },
                { x: norm.permissible.tMax, y: norm.permissible.rhMax },
                { x: norm.permissible.tMin, y: norm.permissible.rhMax },
                { x: norm.permissible.tMin, y: norm.permissible.rhMin }
            ];

            chart.data.datasets[0].data = optZone;
            chart.data.datasets[1].data = permZone;
            chart.data.datasets[2].data = [{ x: env.tDry, y: env.rh }];

            if (evalRes.classScore <= 1) {
                chart.data.datasets[2].backgroundColor = '#297263';
                chart.data.datasets[2].borderColor = '#ffffff';
            } else if (evalRes.classScore <= 2) {
                chart.data.datasets[2].backgroundColor = '#9c651b';
                chart.data.datasets[2].borderColor = '#ffffff';
            } else {
                chart.data.datasets[2].backgroundColor = '#a13e35';
                chart.data.datasets[2].borderColor = '#ffffff';
            }

            chart.update('none');
        }
    }

    // ═══════════════════ РИСК-ИНДИКАТОР ═══════════════════

    function updateRiskGauge(evalRes) {
        const needle = document.getElementById('gaugeNeedle');
        const valEl = document.getElementById('riskGaugeValue');
        const descEl = document.getElementById('riskGaugeDesc');

        let angle = -15;
        let color = '#fbbf24';
        let valText = '2';
        let descText = (typeof I18N !== 'undefined') ? I18N.t('classDesc2') : 'Допустимые условия (класс 2)';

        if (evalRes.classScore <= 1) {
            angle = -60;
            color = '#297263';
            valText = '1';
            descText = (typeof I18N !== 'undefined') ? I18N.t('classDesc1') : 'Оптимальные комфортные условия труда (класс 1)';
        } else if (evalRes.classScore === 2) {
            angle = -15;
            color = '#9c651b';
            valText = '2';
            descText = (typeof I18N !== 'undefined') ? I18N.t('classDesc2') : 'Допустимые параметры по ГОСТ 12.1.005-88 (класс 2)';
        } else if (evalRes.classScore === 3.1) {
            angle = 25;
            color = '#c25e24';
            valText = '3.1';
            descText = (typeof I18N !== 'undefined') ? I18N.t('classDesc31') : 'Вредный 1° — начальные функциональные изменения';
        } else if (evalRes.classScore === 3.2) {
            angle = 55;
            color = '#a13e35';
            valText = '3.2';
            descText = (typeof I18N !== 'undefined') ? I18N.t('classDesc32') : 'Вредный 2° — риск развития производственной патологии';
        } else {
            angle = 80;
            color = '#7f1d1d';
            valText = '3.3';
            descText = (typeof I18N !== 'undefined') ? I18N.t('classDesc33') : 'Вредный 3° — повышенная опасность, требуются СИЗ и перерывы';
        }

        if (needle) {
            needle.style.transform = `rotate(${angle}deg)`;
            needle.setAttribute('stroke', color);
        }
        if (valEl) {
            valEl.textContent = valText;
            valEl.style.color = color;
        }
        if (descEl) {
            descEl.textContent = descText;
        }
    }

    // ═══════════════════ ПОШАГОВЫЙ РАСЧЁТ ФОРМУЛЫ ШПРУНГА ═══════════════════

    function renderFormulaBreakdown(env) {
        const container = document.getElementById('formulaSteps');
        if (!container) return;

        const p = env.psych;
        const deltaT = p.psychrometricDiff;
        const s1 = (typeof I18N !== 'undefined') ? I18N.t('formulaStep1') : '1. Разность температур термометров (&Delta;t):';
        const s2 = (typeof I18N !== 'undefined') ? I18N.t('formulaStep2') : '2. Насыщенный водяной пар при t_вл (Магнус):';
        const s3 = (typeof I18N !== 'undefined') ? I18N.t('formulaStep3') : '3. Насыщенный водяной пар при t_сух (Магнус):';
        const s4 = (typeof I18N !== 'undefined') ? I18N.t('formulaStep4') : '4. Действительная упругость пара по Шпрунгу (Ассман A=0.000662):';
        const s5 = (typeof I18N !== 'undefined') ? I18N.t('formulaStep5') : '5. Итоговая относительная влажность воздуха (&phi;):';

        container.innerHTML = `
            <div class="formula-step">
                <strong>${s1}</strong><br>
                <code>&Delta;t = t_сух - t_вл = ${env.tDry} - ${env.tWet} = ${deltaT} °C</code>
            </div>
            <div class="formula-step">
                <strong>${s2}</strong><br>
                <code>E_вл = 6.112 &times; exp(17.67 &times; ${env.tWet} / (${env.tWet} + 243.5)) = ${p.eWet} гПа</code>
            </div>
            <div class="formula-step">
                <strong>${s3}</strong><br>
                <code>E_сух = 6.112 &times; exp(17.67 &times; ${env.tDry} / (${env.tDry} + 243.5)) = ${p.eDry} гПа</code>
            </div>
            <div class="formula-step">
                <strong>${s4}</strong><br>
                <code>e = E_вл - A &times; P &times; &Delta;t = ${p.eWet} - (0.000662 &times; ${state.pressureHpa} &times; ${deltaT}) = ${p.actualVaporPressure} гПа</code>
            </div>
            <div class="formula-step formula-result-row">
                <strong>${s5}</strong><br>
                <code>&phi; = (e / E_сух) &times; 100% = (${p.actualVaporPressure} / ${p.eDry}) &times; 100% = <strong>${env.rh}%</strong></code>
            </div>
        `;
    }

    // ═══════════════════ ИСТОРИЯ ЗАМЕРОВ И ПЕЧАТЬ ═══════════════════

    function loadHistory() {
        try {
            const stored = localStorage.getItem('microclimate_kz_history');
            if (stored) state.history = JSON.parse(stored);
        } catch (e) { state.history = []; }
    }

    function saveHistoryStorage() {
        try {
            localStorage.setItem('microclimate_kz_history', JSON.stringify(state.history));
        } catch (e) { /* Quota */ }
    }

    function addHistoryEntry() {
        const env = getEffectiveEnvironment();
        const evalRes = evaluateSanPiN(env);
        const preset = SANPIN_DATA.workplacePresets.find(p => p.id === state.selectedPresetId);
        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';

        let presetTitle = 'Өлшеу / Замер';
        if (preset) {
            presetTitle = preset.title.split(':')[0].trim();
            if (typeof I18N !== 'undefined' && I18N.data && I18N.data.presets && I18N.data.presets[preset.id]) {
                const tr = I18N.data.presets[preset.id][lang];
                if (tr && tr.title) presetTitle = tr.title.split(':')[0].trim();
            }
        }

        const entry = {
            id: Date.now(),
            timestamp: new Date().toLocaleString(lang === 'kz' ? 'kk-KZ' : 'ru-RU'),
            preset: presetTitle,
            category: state.category,
            season: state.season === 'cold' ? (lang === 'kz' ? 'Суық' : 'Холодный') : (lang === 'kz' ? 'Жылы' : 'Тёплый'),
            t: env.tDry,
            rh: env.rh,
            v: env.velocity,
            rad: env.radiation,
            workClass: evalRes.workClass,
            classBadge: evalRes.classBadge
        };

        state.history.unshift(entry);
        if (state.history.length > 50) state.history.pop();
        saveHistoryStorage();
        renderHistory();
        showToast(I18N.t('toastSaved', { val: evalRes.workClass.split(' ')[0] }), 'success');
    }

    function deleteHistoryEntry(id) {
        state.history = state.history.filter(h => h.id !== id);
        saveHistoryStorage();
        renderHistory();
    }

    function clearHistory() {
        state.history = [];
        saveHistoryStorage();
        renderHistory();
        showToast(I18N.t('toastCleared'), 'info');
    }

    function renderHistory() {
        const list = document.getElementById('historyList');
        if (!list) return;

        if (state.history.length === 0) {
            list.innerHTML = `<div class="history-empty">${I18N.t('historyEmpty')}</div>`;
            return;
        }

        list.innerHTML = state.history.map(h => `
            <div class="history-item">
                <span class="history-timestamp">${h.timestamp}</span>
                <span class="history-param">t=${h.t}°C</span>
                <span class="history-param">&phi;=${h.rh}%</span>
                <span class="history-param">v=${h.v} м/с</span>
                <span class="history-class"><span class="status-badge ${h.classBadge}">${h.workClass.split(' ')[0]}</span></span>
                <button class="history-delete" data-id="${h.id}" title="Удалить запись / Жазбаны жою">&times;</button>
            </div>
        `).join('');

        list.querySelectorAll('.history-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteHistoryEntry(parseInt(btn.dataset.id));
            });
        });
    }

    function exportPdf() {
        showToast(I18N.t('toastPrinting'), 'info', 1500);
        setTimeout(() => {
            window.print();
        }, 300);
    }

    // ═══════════════════ ТАЙМЕР И ЧАСЫ ПОРТАЛА ═══════════════════

    function initClock() {
        const el = document.getElementById('liveDateTime');
        if (!el) return;
        function update() {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const d = `${pad(now.getDate())}.${pad(now.getMonth() + 1)}.${now.getFullYear()}`;
            const t = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
            el.textContent = `${d} ${t} (UTC+5)`;
        }
        update();
        setInterval(update, 1000);
    }

    // ═══════════════════ УПРАВЛЕНИЕ ИНТЕРФЕЙСОМ И СОБЫТИЯ ═══════════════════

    function init() {
        initClock();
        populatePresetSelector();
        populateCategorySelector();
        renderMeasuresList('all');
        bindEvents();
        loadHistory();
        loadPreset('preset-1');
        initParticles();

        if (typeof I18N !== 'undefined') {
            I18N.onLanguageChange((lang) => {
                I18N.updateDOM();
                populatePresetSelector();
                populateCategorySelector();
                renderMeasuresList(state.currentMeasuresFilter);
                updateChartLanguage();
                updateAll();
            });
            I18N.updateDOM();
        }

        setTimeout(() => {
            initCharts();
            updateChartLanguage();
            updateAll();
        }, 120);
    }

    function populatePresetSelector() {
        const select = document.getElementById('workplacePresetSelect');
        if (!select) return;
        const currentVal = state.selectedPresetId || 'preset-1';
        select.innerHTML = '';
        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';

        SANPIN_DATA.workplacePresets.forEach(preset => {
            const opt = document.createElement('option');
            opt.value = preset.id;
            let title = preset.title;
            if (typeof I18N !== 'undefined' && I18N.data && I18N.data.presets && I18N.data.presets[preset.id]) {
                const tr = I18N.data.presets[preset.id][lang];
                if (tr && tr.title) title = tr.title;
            }
            opt.textContent = title;
            select.appendChild(opt);
        });
        select.value = currentVal;

        // Update preset description
        const descBox = document.getElementById('presetDescription');
        if (descBox) {
            let desc = '';
            const preset = SANPIN_DATA.workplacePresets.find(p => p.id === currentVal);
            if (preset) {
                desc = preset.description;
                if (typeof I18N !== 'undefined' && I18N.data && I18N.data.presets && I18N.data.presets[preset.id]) {
                    const tr = I18N.data.presets[preset.id][lang];
                    if (tr && tr.description) desc = tr.description;
                }
            }
            descBox.textContent = desc;
        }

        // Update scenario quick buttons
        document.querySelectorAll('.scenario-btn').forEach(btn => {
            const pid = btn.dataset.presetId || btn.dataset.preset;
            if (pid && typeof I18N !== 'undefined' && I18N.dict[lang] && I18N.dict[lang].scenarios && I18N.dict[lang].scenarios[pid]) {
                btn.textContent = I18N.dict[lang].scenarios[pid];
            }
        });
    }

    function populateCategorySelector() {
        const catSelect = document.getElementById('categorySelect');
        if (!catSelect) return;
        const currentVal = state.category || 'Ia';
        catSelect.innerHTML = '';
        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';

        Object.keys(SANPIN_DATA.categories).forEach(k => {
            const opt = document.createElement('option');
            opt.value = k;
            let name = SANPIN_DATA.categories[k].name;
            if (typeof I18N !== 'undefined' && I18N.data && I18N.data.categories && I18N.data.categories[k]) {
                const tr = I18N.data.categories[k][lang];
                if (tr && tr.name) name = tr.name;
            }
            opt.textContent = name;
            catSelect.appendChild(opt);
        });
        catSelect.value = currentVal;
    }

    function loadPreset(presetId) {
        const preset = SANPIN_DATA.workplacePresets.find(p => p.id === presetId);
        if (!preset) return;

        state.selectedPresetId = preset.id;
        state.category = preset.category;
        state.season = preset.season;
        state.rawTempDry = preset.baseTempDry;
        state.rawTempWet = preset.baseTempWet;
        state.rawAnemometerDelta = preset.baseAnemometerDelta;
        state.rawRadiation = preset.baseRadiation;

        // Сброс всех мер
        Object.keys(state.measures).forEach(k => state.measures[k] = false);
        syncMeasuresCheckboxes();
        syncSlidersWithRaw();

        const sel = document.getElementById('workplacePresetSelect');
        if (sel) sel.value = preset.id;
        const cat = document.getElementById('categorySelect');
        if (cat) cat.value = preset.category;
        const sCold = document.getElementById('seasonCold');
        const sWarm = document.getElementById('seasonWarm');
        if (sCold && sWarm) {
            if (preset.season === 'cold') sCold.checked = true;
            else sWarm.checked = true;
        }

        const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';
        let desc = preset.description;
        let title = preset.title;
        if (typeof I18N !== 'undefined' && I18N.data && I18N.data.presets && I18N.data.presets[preset.id]) {
            const tr = I18N.data.presets[preset.id][lang];
            if (tr) {
                if (tr.description) desc = tr.description;
                if (tr.title) title = tr.title;
            }
        }

        const descEl = document.getElementById('presetDescription');
        if (descEl) descEl.textContent = desc;

        updateAll();
        showToast(I18N.t('toastPresetLoaded', { title: title.split(':')[0] }), 'info');
    }

    function syncSlidersWithRaw() {
        const sDry = document.getElementById('sliderTempDry');
        const sWet = document.getElementById('sliderTempWet');
        const sDelta = document.getElementById('sliderDeltaN');
        const sRad = document.getElementById('sliderRadiation');

        const vDry = document.getElementById('sliderTempDryVal');
        const vWet = document.getElementById('sliderTempWetVal');
        const vDelta = document.getElementById('sliderDeltaNVal');
        const vRad = document.getElementById('sliderRadiationVal');

        if (sDry) sDry.value = state.rawTempDry;
        if (sWet) sWet.value = state.rawTempWet;
        if (sDelta) sDelta.value = state.rawAnemometerDelta;
        if (sRad) sRad.value = state.rawRadiation;

        if (vDry) vDry.textContent = `${state.rawTempDry.toFixed(1)} °C`;
        if (vWet) vWet.textContent = `${state.rawTempWet.toFixed(1)} °C`;
        if (vDelta) vDelta.textContent = `${state.rawAnemometerDelta} дел`;
        if (vRad) vRad.textContent = `${state.rawRadiation} Вт/м²`;
    }

    function syncMeasuresCheckboxes() {
        Object.keys(state.measures).forEach(k => {
            const cb = document.getElementById(`measure_${k}`);
            if (cb) cb.checked = state.measures[k];
        });
    }

    function bindEvents() {
        // Выбор варианта
        const presetSelect = document.getElementById('workplacePresetSelect');
        if (presetSelect) presetSelect.addEventListener('change', (e) => loadPreset(e.target.value));

        // Быстрые кнопки сценариев
        document.querySelectorAll('.scenario-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const pid = btn.dataset.preset;
                if (pid) loadPreset(pid);
            });
        });

        // Фильтры каталога мер
        document.querySelectorAll('.measure-filter-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.measure-filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const filter = btn.dataset.filter || 'all';
                renderMeasuresList(filter);
            });
        });

        // Категория
        const catSelect = document.getElementById('categorySelect');
        if (catSelect) catSelect.addEventListener('change', (e) => {
            state.category = e.target.value;
            updateAll();
        });

        // Сезон
        document.querySelectorAll('input[name="seasonRadio"]').forEach(r => {
            r.addEventListener('change', (e) => {
                state.season = e.target.value;
                updateAll();
            });
        });

        // Интерактивные ползунки
        const sDry = document.getElementById('sliderTempDry');
        const sWet = document.getElementById('sliderTempWet');
        const sDelta = document.getElementById('sliderDeltaN');
        const sRad = document.getElementById('sliderRadiation');

        if (sDry) sDry.addEventListener('input', (e) => {
            state.rawTempDry = parseFloat(e.target.value);
            document.getElementById('sliderTempDryVal').textContent = `${state.rawTempDry.toFixed(1)} °C`;
            if (state.rawTempWet > state.rawTempDry) {
                state.rawTempWet = state.rawTempDry;
                if (sWet) sWet.value = state.rawTempWet;
                document.getElementById('sliderTempWetVal').textContent = `${state.rawTempWet.toFixed(1)} °C`;
            }
            updateAll();
        });

        if (sWet) sWet.addEventListener('input', (e) => {
            state.rawTempWet = parseFloat(e.target.value);
            if (state.rawTempWet > state.rawTempDry) {
                state.rawTempDry = state.rawTempWet;
                if (sDry) sDry.value = state.rawTempDry;
                document.getElementById('sliderTempDryVal').textContent = `${state.rawTempDry.toFixed(1)} °C`;
            }
            document.getElementById('sliderTempWetVal').textContent = `${state.rawTempWet.toFixed(1)} °C`;
            updateAll();
        });

        if (sDelta) sDelta.addEventListener('input', (e) => {
            state.rawAnemometerDelta = parseInt(e.target.value);
            document.getElementById('sliderDeltaNVal').textContent = `${state.rawAnemometerDelta} дел`;
            updateAll();
        });

        if (sRad) sRad.addEventListener('input', (e) => {
            state.rawRadiation = parseInt(e.target.value);
            document.getElementById('sliderRadiationVal').textContent = `${state.rawRadiation} Вт/м²`;
            updateAll();
        });

        // Кнопка сброса ползунков к активному пресету
        const btnResetSliders = document.getElementById('btnResetSliders');
        if (btnResetSliders) {
            btnResetSliders.addEventListener('click', () => {
                const preset = SANPIN_DATA.workplacePresets.find(p => p.id === state.selectedPresetId);
                if (preset) {
                    state.rawTempDry = preset.baseTempDry;
                    state.rawTempWet = preset.baseTempWet;
                    state.rawAnemometerDelta = preset.baseAnemometerDelta;
                    state.rawRadiation = preset.baseRadiation;
                    syncSlidersWithRaw();
                    updateAll();
                    showToast(I18N.t('toastSlidersReset'), 'info');
                }
            });
        }

        // Сброс всех мер
        const btnResetMeasures = document.getElementById('btnResetMeasures');
        if (btnResetMeasures) btnResetMeasures.addEventListener('click', () => {
            Object.keys(state.measures).forEach(k => state.measures[k] = false);
            syncMeasuresCheckboxes();
            updateAll();
            showToast(I18N.t('toastMeasuresReset'), 'info', 2000);
        });

        // Переключатель языка (RU / ҚАЗ)
        document.querySelectorAll('.lang-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const lang = btn.dataset.lang;
                if (lang && typeof I18N !== 'undefined') {
                    I18N.setLang(lang);
                }
            });
        });

        // Приборы
        const btnAspirator = document.getElementById('btnStartAspirator');
        if (btnAspirator) btnAspirator.addEventListener('click', toggleAspirator);

        const btnAnemometer = document.getElementById('btnStartAnemometer');
        if (btnAnemometer) btnAnemometer.addEventListener('click', toggleAnemometer);

        // История и экспорт
        const btnSaveHistory = document.getElementById('btnSaveHistory');
        if (btnSaveHistory) btnSaveHistory.addEventListener('click', addHistoryEntry);

        const btnClearHistory = document.getElementById('btnClearHistory');
        if (btnClearHistory) btnClearHistory.addEventListener('click', clearHistory);

        const btnExportPdf = document.getElementById('btnExportPdf');
        if (btnExportPdf) btnExportPdf.addEventListener('click', exportPdf);

        const btnQuickSave = document.getElementById('btnQuickSave');
        if (btnQuickSave) btnQuickSave.addEventListener('click', addHistoryEntry);

        const btnQuickExport = document.getElementById('btnQuickExport');
        if (btnQuickExport) btnQuickExport.addEventListener('click', exportPdf);

        const btnSidebarPrint = document.getElementById('btnSidebarPrint');
        if (btnSidebarPrint) btnSidebarPrint.addEventListener('click', exportPdf);

        // Аккордеон формулы Шпрунга
        const btnFormula = document.getElementById('btnFormulaToggle');
        const contentFormula = document.getElementById('formulaContent');
        const formulaToggleText = document.getElementById('formulaToggleText');
        if (btnFormula && contentFormula) {
            btnFormula.addEventListener('click', () => {
                state.formulaExpanded = !state.formulaExpanded;
                btnFormula.classList.toggle('open', state.formulaExpanded);
                contentFormula.classList.toggle('open', state.formulaExpanded);
                if (formulaToggleText) {
                    formulaToggleText.textContent = state.formulaExpanded ? I18N.t('btnFormulaHide') : I18N.t('btnFormulaShow');
                }
            });
        }

        // Переключение табов
        const navBtns = document.querySelectorAll('.nav-tab-btn');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                navBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const targetTabId = btn.dataset.tab;

                document.querySelectorAll('.tab-content-panel').forEach(panel => {
                    if (panel.id === targetTabId) {
                        panel.classList.add('tab-entering');
                        panel.offsetHeight; // reflow
                        panel.classList.remove('tab-entering');
                        panel.classList.add('tab-active');

                        if (targetTabId === 'tabCharts') {
                            const env = getEffectiveEnvironment();
                            const evalRes = evaluateSanPiN(env);
                            updateCharts(env, evalRes);
                        }
                    } else {
                        panel.classList.remove('tab-active');
                    }
                });
            });
        });
    }

    // ═══════════════════ ПРИБОРЫ (ИНТЕРАКТИВ) ═══════════════════

    function toggleAspirator() {
        const btn = document.getElementById('btnStartAspirator');
        const fan = document.getElementById('aspiratorFanIcon');
        const statusText = document.getElementById('aspiratorStatusText');

        if (state.instruments.aspiratorRunning) {
            clearInterval(state.instruments.aspiratorTimer);
            state.instruments.aspiratorRunning = false;
            if (btn) { btn.textContent = I18N.t('btnAspiratorStart'); btn.classList.replace('btn-danger', 'btn-primary'); }
            if (fan) fan.classList.remove('spin-fast');
            if (statusText) statusText.textContent = I18N.t('aspiratorOff');
        } else {
            state.instruments.aspiratorRunning = true;
            state.instruments.aspiratorSecondsLeft = 4;
            if (btn) { btn.textContent = I18N.t('btnAspiratorStop'); btn.classList.replace('btn-primary', 'btn-danger'); }
            if (fan) fan.classList.add('spin-fast');
            if (statusText) statusText.textContent = I18N.t('aspiratorRunning', { sec: state.instruments.aspiratorSecondsLeft });

            state.instruments.aspiratorTimer = setInterval(() => {
                state.instruments.aspiratorSecondsLeft--;
                if (state.instruments.aspiratorSecondsLeft <= 0) {
                    clearInterval(state.instruments.aspiratorTimer);
                    state.instruments.aspiratorRunning = false;
                    if (btn) { btn.textContent = I18N.t('btnAspiratorStart'); btn.classList.replace('btn-danger', 'btn-primary'); }
                    if (fan) fan.classList.remove('spin-fast');
                    if (statusText) statusText.textContent = I18N.t('aspiratorDone');
                    showToast(I18N.t('toastPsychDone'), 'success', 2500);
                } else {
                    if (statusText) statusText.textContent = I18N.t('aspiratorRunning', { sec: state.instruments.aspiratorSecondsLeft });
                }
            }, 1000);
        }
    }

    function toggleAnemometer() {
        const btn = document.getElementById('btnStartAnemometer');
        const blades = document.getElementById('anemometerBlades');
        const timerDisplay = document.getElementById('anemometerTimerDisplay');
        const countDisplay = document.getElementById('anemometerCounterDisplay');

        if (state.instruments.anemometerRunning) {
            clearInterval(state.instruments.anemometerTimer);
            state.instruments.anemometerRunning = false;
            if (btn) { btn.textContent = I18N.t('btnAnemStart'); btn.classList.replace('btn-danger', 'btn-primary'); }
            if (blades) blades.classList.remove('spin-wind');
            return;
        }

        state.instruments.anemometerRunning = true;
        state.instruments.anemometerSecondsLeft = state.instruments.anemometerDuration;
        const env = getEffectiveEnvironment();
        const delta = Math.round(env.anem.deltaN);
        const startVal = state.instruments.anemometerStartCount;
        const endVal = startVal + delta;

        if (btn) { btn.textContent = I18N.t('btnAnemRunning'); btn.classList.replace('btn-primary', 'btn-danger'); }
        if (blades) {
            blades.classList.add('spin-wind');
            const speedSec = Math.max(0.12, (1.2 / (env.velocity + 0.2))).toFixed(2);
            blades.style.animationDuration = `${speedSec}s`;
        }

        const totalTicks = 20;
        let tick = 0;

        state.instruments.anemometerTimer = setInterval(() => {
            tick++;
            state.instruments.anemometerSecondsLeft = totalTicks - tick;
            const currentVal = Math.round(startVal + (delta * (tick / totalTicks)));
            state.instruments.anemometerCurrentCount = currentVal;

            if (timerDisplay) timerDisplay.textContent = `${state.instruments.anemometerSecondsLeft} с`;
            if (countDisplay) countDisplay.textContent = currentVal;

            if (tick >= totalTicks) {
                clearInterval(state.instruments.anemometerTimer);
                state.instruments.anemometerRunning = false;
                state.instruments.anemometerStartCount = endVal;
                if (btn) { btn.textContent = I18N.t('btnAnemRepeat'); btn.classList.replace('btn-danger', 'btn-primary'); }
                if (blades) blades.classList.remove('spin-wind');
                if (timerDisplay) timerDisplay.textContent = I18N.t('anemDone');
                showToast(I18N.t('toastAnemDone', { val: env.velocity }), 'success', 2500);
                updateAll();
            }
        }, 1000);
    }

    // ═══════════════════ СИНХРОНИЗАЦИЯ И РЕНДЕР ═══════════════════

    let prevClassScore = null;

    function updateAll() {
        const env = getEffectiveEnvironment();
        const evalRes = evaluateSanPiN(env);

        updateInstrumentsUI(env);
        updateDashboard(env, evalRes);
        updateRiskGauge(evalRes);
        renderFormulaBreakdown(env);
        updateSanpinEvalUI(env, evalRes);
        syncMeasuresCheckboxes();
        updateMeasuresImpactSummary(env, evalRes);
        renderRecommendations(evalRes);
        updateCharts(env, evalRes);
        renderHistory();

        // Уведомление при изменении класса
        if (prevClassScore !== null && prevClassScore !== evalRes.classScore) {
            if (evalRes.classScore < prevClassScore) {
                showToast(`📉 Условия труда улучшены &rarr; Класс ${evalRes.workClass.split(' ')[0]}`, 'success');
            } else if (evalRes.classScore > prevClassScore) {
                showToast(`⚠️ Ухудшение условий: Класс ${evalRes.workClass.split(' ')[0]}`, 'warning');
            }
        }
        prevClassScore = evalRes.classScore;
    }

    function updateDashboard(env, evalRes) {
        const dashTemp = document.getElementById('dashTemp');
        const dashRh = document.getElementById('dashRh');
        const dashV = document.getElementById('dashV');
        const dashRad = document.getElementById('dashRad');
        const dashClass = document.getElementById('dashClass');
        const dashClassLabel = document.getElementById('dashClassLabel');

        const dashTempFoot = document.getElementById('dashTempFoot');
        const dashRhFoot = document.getElementById('dashRhFoot');
        const dashVFoot = document.getElementById('dashVFoot');
        const dashRadFoot = document.getElementById('dashRadFoot');
        const dashClassFoot = document.getElementById('dashClassFoot');

        if (dashTemp) dashTemp.textContent = env.tDry.toFixed(1);
        if (dashRh) dashRh.textContent = env.rh.toFixed(1);
        if (dashV) dashV.textContent = env.velocity.toFixed(2);
        if (dashRad) dashRad.textContent = env.radiation;

        if (dashClass) {
            dashClass.textContent = evalRes.workClass.split(' ')[0];
        }
        if (dashClassLabel) {
            const parts = evalRes.workClass.split(' ');
            const lang = (typeof I18N !== 'undefined') ? I18N.getLang() : 'ru';
            dashClassLabel.textContent = parts.slice(1).join(' ') || (evalRes.classScore <= 1 ? (lang === 'kz' ? 'Оңтайлы' : 'Оптимальный') : evalRes.classScore === 2 ? (lang === 'kz' ? 'Рұқсат етілген' : 'Допустимый') : (lang === 'kz' ? 'Зиянды' : 'Вредный'));
        }

        // Индикаторы статуса в карточках метрик
        if (dashTempFoot) {
            const isOpt = evalRes.tStatus === 'optimal';
            const isHarm = evalRes.tStatus.startsWith('harmful');
            const dotClass = isOpt ? 'dot-green' : isHarm ? 'dot-red' : 'dot-amber';
            const label = isOpt ? I18N.t('dotOptimal') : isHarm ? I18N.t('dotHarmful') : I18N.t('dotPermissible');
            dashTempFoot.innerHTML = `<span class="indicator-dot ${dotClass}"></span> ${label}`;
        }

        if (dashRhFoot) {
            const isOpt = evalRes.rhStatus === 'optimal';
            const isHarm = evalRes.rhStatus.startsWith('harmful');
            const dotClass = isOpt ? 'dot-green' : isHarm ? 'dot-red' : 'dot-amber';
            const label = isOpt ? I18N.t('dotOptimal') : isHarm ? I18N.t('dotHarmful') : I18N.t('dotPermissible');
            dashRhFoot.innerHTML = `<span class="indicator-dot ${dotClass}"></span> ${label}`;
        }

        if (dashVFoot) {
            const isOpt = evalRes.vStatus === 'optimal';
            const isHarm = evalRes.vStatus.startsWith('harmful');
            const dotClass = isOpt ? 'dot-green' : isHarm ? 'dot-red' : 'dot-amber';
            const label = isOpt ? I18N.t('dotAirComfort') : isHarm ? I18N.t('dotAirDraft') : I18N.t('dotAirCalm');
            dashVFoot.innerHTML = `<span class="indicator-dot ${dotClass}"></span> ${label}`;
        }

        if (dashRadFoot) {
            const isOpt = evalRes.radStatus === 'optimal';
            const isHarm = evalRes.radStatus.startsWith('harmful');
            const dotClass = isOpt ? 'dot-green' : isHarm ? 'dot-red' : 'dot-amber';
            const label = isOpt ? I18N.t('dotRadSafe') : isHarm ? I18N.t('dotRadDanger') : I18N.t('dotRadPpe');
            dashRadFoot.innerHTML = `<span class="indicator-dot ${dotClass}"></span> ${label}`;
        }

        if (dashClassFoot) {
            const dotClass = evalRes.classScore <= 1 ? 'dot-green' : evalRes.classScore <= 2 ? 'dot-amber' : 'dot-red';
            dashClassFoot.innerHTML = `<span class="indicator-dot ${dotClass}"></span> ${I18N.t('dotLaborCode')}`;
        }
    }

    function updateInstrumentsUI(env) {
        const dryVal = document.getElementById('dryTempVal');
        const wetVal = document.getElementById('wetTempVal');
        const dryColumn = document.getElementById('dryTempMercury');
        const wetColumn = document.getElementById('wetTempMercury');

        if (dryVal) dryVal.textContent = `${env.tDry.toFixed(1)} °C`;
        if (wetVal) wetVal.textContent = `${env.tWet.toFixed(1)} °C`;

        const calcMercuryHeight = (t) => {
            const clamped = Math.max(-10, Math.min(50, t));
            return ((clamped + 10) / 60) * 100;
        };

        if (dryColumn) dryColumn.style.height = `${calcMercuryHeight(env.tDry)}%`;
        if (wetColumn) wetColumn.style.height = `${calcMercuryHeight(env.tWet)}%`;

        const psychDiff = document.getElementById('psychDiffVal');
        const vaporPress = document.getElementById('vaporPressVal');
        const calcRh = document.getElementById('calcRhVal');

        if (psychDiff) psychDiff.textContent = `${env.psych.psychrometricDiff} °C`;
        if (vaporPress) vaporPress.textContent = `${env.psych.actualVaporPressure} гПа`;
        if (calcRh) calcRh.textContent = `${env.rh}%`;

        const anemVel = document.getElementById('anemometerVelocityVal');
        const anemDelta = document.getElementById('anemometerDeltaVal');
        const unitDiv = (typeof I18N !== 'undefined') ? I18N.t('unitsDiv') : 'дел';
        if (anemVel) anemVel.textContent = `${env.velocity} м/с`;
        if (anemDelta) anemDelta.textContent = `${env.anem.deltaN} ${unitDiv}`;

        const radVal = document.getElementById('radiationVal');
        const tnsVal = document.getElementById('tnsVal');
        const globeVal = document.getElementById('globeTempVal');
        if (radVal) radVal.textContent = `${env.radiation} Вт/м²`;
        if (tnsVal) tnsVal.textContent = `${env.tnsIndex} °C`;
        if (globeVal) globeVal.textContent = `${env.tGlobe} °C`;
    }

    function updateSanpinEvalUI(env, evalRes) {
        const classEl = document.getElementById('workClassTitle');
        const badgeEl = document.getElementById('workClassBadge');
        const classTitleLabel = (typeof I18N !== 'undefined') ? I18N.t('statClassLabel') : 'Класс условий труда';

        if (classEl) classEl.innerHTML = `<strong>${classTitleLabel}: ${evalRes.workClass}</strong>`;
        if (badgeEl) {
            badgeEl.className = `status-badge ${evalRes.classBadge}`;
            badgeEl.textContent = evalRes.workClass;
        }

        const unitC = '°C';
        const unitMs = 'м/с';
        const unitWm = 'Вт/м²';
        const ppeText = (typeof I18N !== 'undefined' && I18N.getLang() === 'kz') ? '≤ 350 Вт/м² (ЖҚҚ-мен)' : '≤ 350 Вт/м² (с СИЗ)';

        setRowStatus('tEvalRow', `${env.tDry} ${unitC}`, `${evalRes.norm.optimal.tMin}–${evalRes.norm.optimal.tMax} ${unitC}`, `${evalRes.norm.permissible.tMin}–${evalRes.norm.permissible.tMax} ${unitC}`, evalRes.tStatus);
        setRowStatus('rhEvalRow', `${env.rh}%`, `${evalRes.norm.optimal.rhMin}–${evalRes.norm.optimal.rhMax}%`, `${evalRes.norm.permissible.rhMin}–${evalRes.norm.permissible.rhMax}%`, evalRes.rhStatus);
        setRowStatus('vEvalRow', `${env.velocity} ${unitMs}`, `≤ ${evalRes.norm.optimal.vMax} ${unitMs}`, `≤ ${evalRes.norm.permissible.vMax} ${unitMs}`, evalRes.vStatus);
        setRowStatus('radEvalRow', `${env.radiation} ${unitWm}`, `≤ 140 ${unitWm}`, ppeText, evalRes.radStatus);

        const reasonsList = document.getElementById('evalReasonsList');
        if (reasonsList) {
            reasonsList.innerHTML = '';
            evalRes.reasons.forEach(r => {
                const li = document.createElement('li');
                li.textContent = r;
                reasonsList.appendChild(li);
            });
        }
    }

    function setRowStatus(rowId, actualVal, optNorm, permNorm, status) {
        const row = document.getElementById(rowId);
        if (!row) return;

        const valCell = row.querySelector('.val-cell');
        const optCell = row.querySelector('.opt-cell');
        const permCell = row.querySelector('.perm-cell');
        const statusCell = row.querySelector('.status-cell');

        if (valCell) valCell.textContent = actualVal;
        if (optCell) optCell.textContent = optNorm;
        if (permCell) permCell.textContent = permNorm;

        if (statusCell) {
            if (status === 'optimal') {
                statusCell.innerHTML = `<span class="tag tag-success">${I18N.t('statusOptimal')}</span>`;
            } else if (status === 'permissible' || status === 'permissible_with_ppe' || status === 'permissible_low') {
                statusCell.innerHTML = `<span class="tag tag-warning">${I18N.t('statusPermissible')}</span>`;
            } else {
                statusCell.innerHTML = `<span class="tag tag-danger">${I18N.t('statusHarmful')}</span>`;
            }
        }
    }

    function updateMeasuresImpactSummary(env, evalRes) {
        const measuresSummary = document.getElementById('measuresImpactSummary');
        if (!measuresSummary) return;

        const activeCount = Object.values(state.measures).filter(Boolean).length;
        if (activeCount === 0) {
            measuresSummary.innerHTML = `
                <div class="alert alert-info">
                    ${I18N.t('measuresEmptyAlert')}
                </div>
            `;
        } else {
            const alertClass = evalRes.classScore <= 2 ? 'alert-success' : 'alert-warning';
            measuresSummary.innerHTML = `
                <div class="alert ${alertClass}">
                    ${I18N.t('measuresActiveAlert', {
                        count: activeCount,
                        workClass: evalRes.workClass,
                        t: env.tDry,
                        rh: env.rh,
                        v: env.velocity,
                        rad: env.radiation
                    })}
                </div>
            `;
        }
    }

    // ═══════════════════ ИНИЦИАЛИЗАЦИЯ ═══════════════════

    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
        } else {
            init();
        }
    }

    const exported = {
        state,
        calcPsychrometer,
        calcAnemometer,
        calcRadiation,
        getEffectiveEnvironment,
        evaluateSanPiN,
        loadPreset,
        updateAll,
        renderMeasuresList
    };

    if (typeof window !== 'undefined') window.MicroclimateApp = exported;
    if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})();

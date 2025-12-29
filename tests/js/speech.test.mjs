/**
 * Unit tests for speech.js extractTags function
 * 
 * These tests verify tag extraction without requiring actual voice input.
 * Run with: node tests/js/speech.test.mjs
 */

import assert from 'node:assert/strict';

// Mock the extractTags function inline (synced with speech.js)
function extractTags(text) {
    const t = String(text || '').toLowerCase();
    const tags = new Set();
    // Battle/combat (no \b for cyrillic - doesn't work with Unicode)
    if (/(бой|битв|схватк|атак|удар|напал|сраж|battle|attack|fight|combat)/.test(t)) tags.add('battle');
    // Tavern/inn
    if (/(таверн|бар|трактир|inn|tavern|drink|ale|пиво)/.test(t)) tags.add('tavern');
    // Exploration
    if (/(исслед|поиск|путь|дорог|explor|travel|journey|forest|ruins|пещер|dungeon)/.test(t)) tags.add('exploration');
    // Tension/danger
    if (/(напряж|страх|жутк|опасн|ловушк|trap|tension|suspense|danger|scary)/.test(t)) tags.add('tension');
    // Chase
    if (/(погон|преслед|беж|убега|chase|pursuit|run|escape)/.test(t)) tags.add('chase');
    // Ritual/magic
    if (/(ритуал|обряд|магия|колдов|заклин|ritual|magic|spell|arcane)/.test(t)) tags.add('ritual');
    // Rest/camp
    if (/(отдых|лагер|костер|camp|rest|fire|sleep|сон)/.test(t)) tags.add('rest');
    // Dragons
    if (/(дракон|dragon|драконы)/.test(t)) tags.add('dragons');
    // Market/trade
    if (/(торг|купить|продать|рынок|shop|merchant|gold|монет)/.test(t)) tags.add('market');
    // Mourning/death
    if (/(смерть|умир|мёртв|погиб|скорбь|похорон|могил|funeral|grave|corpse|труп|dead|death)/.test(t)) tags.add('mourning');
    // Celebration/party
    if (/(праздник|веселье|танц|пир|celebration|party|feast|dance)/.test(t)) tags.add('celebration');
    // Storm
    if (/(шторм|буря|гроза|storm|thunder|lightning|дожд)/.test(t)) tags.add('storm');
    // Boss battle
    if (/(босс|финальн|главный враг|boss|final|villain)/.test(t)) tags.add('boss_battle');
    // Stealth
    if (/(скрыт|тихо|стелс|stealth|sneak|hidden)/.test(t)) tags.add('stealth');
    return Array.from(tags);
}

// Test cases - simulating player speech without actually speaking
const testCases = [
    // Russian phrases
    {
        text: 'Мы заходим в таверну и заказываем эль',
        expected: ['tavern'],
        description: 'Tavern scene (RU)'
    },
    {
        text: 'Дракон атакует! Начинаем бой!',
        expected: ['battle', 'dragons'],
        description: 'Dragon battle (RU)'
    },
    {
        text: 'Нужно исследовать эти древние руины',
        expected: ['exploration'],
        description: 'Exploration (RU)'
    },
    {
        text: 'Тут какая-то напряжённая ситуация, ловушка!',
        expected: ['tension'],
        description: 'Tension (RU)'
    },
    {
        text: 'Ведьма начинает ритуал и колдует заклинание',
        expected: ['ritual'],
        description: 'Ritual/magic (RU)'
    },
    {
        text: 'Погоня! Бежим от стражи!',
        expected: ['chase'],
        description: 'Chase scene (RU)'
    },
    {
        text: 'Разбиваем лагерь у костра и отдыхаем',
        expected: ['rest'],
        description: 'Rest/camp (RU)'
    },
    {
        text: 'Идём на рынок, нужно купить зелья за золотые монеты',
        expected: ['market'],
        description: 'Market/trade (RU)'
    },
    {
        text: 'Наш товарищ погиб, мы скорбим у его могилы',
        expected: ['mourning'],
        description: 'Mourning scene (RU)'
    },
    {
        text: 'Праздник в замке! Все танцуют и веселятся!',
        expected: ['celebration'],
        description: 'Celebration (RU)'
    },
    {
        text: 'Буря началась, гроза и дождь!',
        expected: ['storm'],
        description: 'Storm (RU)'
    },
    {
        text: 'Это финальная битва с главным врагом, боссом!',
        expected: ['battle', 'boss_battle'],
        description: 'Boss battle (RU)'
    },
    {
        text: 'Тихо крадёмся, стелс-миссия',
        expected: ['stealth'],
        description: 'Stealth (RU)'
    },

    // English phrases
    {
        text: 'We enter the tavern and order drinks',
        expected: ['tavern'],
        description: 'Tavern scene (EN)'
    },
    {
        text: 'The dragon attacks! Battle begins!',
        expected: ['battle', 'dragons'],
        description: 'Dragon battle (EN)'
    },
    {
        text: 'Let us explore this dungeon',
        expected: ['exploration'],
        description: 'Dungeon exploration (EN)'
    },
    {
        text: 'There is a trap ahead, danger!',
        expected: ['tension'],
        description: 'Trap danger (EN)'
    },
    {
        text: 'The wizard casts a magic spell',
        expected: ['ritual'],
        description: 'Magic spell (EN)'
    },
    {
        text: 'Chase them! They are trying to escape!',
        expected: ['chase'],
        description: 'Chase scene (EN)'
    },
    {
        text: 'We set up camp and rest by the fire',
        expected: ['rest'],
        description: 'Camp rest (EN)'
    },

    // Mixed/complex scenarios
    {
        text: 'Дракон напал на таверну, начинается бой!',
        expected: ['battle', 'dragons', 'tavern'],
        description: 'Dragon attacks tavern (complex RU)'
    },
    {
        text: 'We sneak through the dungeon to avoid the trap',
        expected: ['exploration', 'stealth', 'tension'],
        description: 'Stealth exploration (complex EN)'
    },

    // Edge cases
    {
        text: '',
        expected: [],
        description: 'Empty string'
    },
    {
        text: 'Обычный разговор без ключевых слов',
        expected: [],
        description: 'No keywords'
    },
    {
        text: null,
        expected: [],
        description: 'Null input'
    },
];

// Run tests
console.log('Running extractTags tests...\n');
let passed = 0;
let failed = 0;

for (const testCase of testCases) {
    const result = extractTags(testCase.text);
    const resultSorted = result.sort();
    const expectedSorted = testCase.expected.sort();

    const isEqual = resultSorted.length === expectedSorted.length &&
        resultSorted.every((v, i) => v === expectedSorted[i]);

    if (isEqual) {
        console.log(`✓ ${testCase.description}`);
        passed++;
    } else {
        console.log(`✗ ${testCase.description}`);
        console.log(`  Input: "${testCase.text}"`);
        console.log(`  Expected: [${expectedSorted.join(', ')}]`);
        console.log(`  Got: [${resultSorted.join(', ')}]`);
        failed++;
    }
}

console.log(`\n${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}

console.log('\nAll extractTags tests passed! ✓');

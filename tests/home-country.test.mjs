import { load, harness } from './helpers.mjs';
const t = harness('Home country category');
const story = (id, category, countries, region='world') => ({id, category, countries, region, title:id, summary:'', source:'Fixture', tier:2, url:`https://example.com/${id}`});
const stories = [
  story('spain', 'local-politics', ['ES'], 'spain'),
  story('france', 'geopolitics', ['FR'], 'europe'),
  story('french-tech', 'technology', ['FR'], 'europe'),
  story('french-economy', 'economic-finance', ['FR'], 'europe'),
  story('germany', 'geopolitics', ['DE'], 'europe'),
  story('unknown', 'geopolitics', []),
  story('spanish-fallback', 'local-politics', [], 'spain'),
];
const {w,d,tab,press,pick,display} = load({stories,withStyles:true});
const ids = () => [...d.querySelectorAll('#list .card')].map(n=>n.dataset.id).sort().join(',');
const homeLabel = () => d.querySelector('#cats [data-value="local-politics"]').textContent;
tab('feed');
t.ok('defaults to Spain', homeLabel()==='Spain' && d.getElementById('home-country').value==='ES');
press('#cats .cat-btn', 'local-politics');
t.ok('Spain contains Spanish general news', ids()==='spain,spanish-fallback');
pick('home-country','FR');
t.ok('category is renamed France', homeLabel()==='France');
t.ok('France contains French general news only', ids()==='france');
t.ok('card label also updates', d.querySelector('#list .cat').textContent==='France');
t.ok('choice persisted', JSON.parse(w.localStorage.getItem('newsdesk:homeCountry'))==='FR');
press('#cats .cat-btn','technology');
t.ok('French technology stays in its subject', ids()==='french-tech');
press('#cats .cat-btn','economic-finance');
t.ok('French economy stays in its subject', ids()==='french-economy');
press('#cats .cat-btn','geopolitics');
t.ok('old home articles move to world category', ids()==='germany,spain,spanish-fallback,unknown');
press('#cats .cat-btn','all');
t.ok('all retains each article exactly once', new Set(ids().split(',')).size===stories.length);
t.ok('stored classification untouched', w.DATA.stories.find(s=>s.id==='france').category==='geopolitics');
pick('country','DE');
t.ok('country filter independent', ids()==='germany' && homeLabel()==='France');
d.getElementById('reset').click();
t.ok('filter reset preserves home preference', homeLabel()==='France' && d.getElementById('home-country').value==='FR');
pick('home-country','JP');press('#cats .cat-btn','local-politics');
t.ok('country without articles has honest empty state', ids()==='' && d.getElementById('end').textContent.includes('Nothing matches'));
tab('reports');
t.ok('home control hidden in Reports', display(d.querySelector('.category-row'))==='none');
const reload=load({stories,storage:{homeCountry:'FR',category:'local-politics',tab:'feed'}});
t.ok('reload restores selection and articles', reload.d.getElementById('home-country').value==='FR' && reload.d.querySelector('#list .card').dataset.id==='france');
const invalid=load({stories,storage:{homeCountry:'invalid'}});
t.ok('invalid saved country falls back to Spain', invalid.d.getElementById('home-country').value==='ES');
t.done();

import { load, harness } from './helpers.mjs';
const t = harness('Structured brief items');
const { w, d, tab } = load({ withStyles: true });
w.SUMMARY.news = [{category:'science',label:'Science',count:2,points:['A concise summary.','Original headline'],items:[
  {event_id:'a',text:'A concise summary.',status:'summarized',coverage_count:2,sources:[{id:'a',source:'Science source',url:'https://example.com/article',published:w.DATA.generated}]},
  {event_id:'b',text:'Original headline',status:'headline-fallback',sources:[{id:'b',source:'Unsafe',url:'javascript:alert(1)',published:w.DATA.generated}]}
]}];
w.SUMMARY.news_generated = '2026-08-30T12:00:00Z';
tab('feed');tab('summary');
t.ok('structured text renders', d.querySelector('.brief-text').textContent === 'A concise summary.');
const link=d.querySelector('.brief-sources a');
t.ok('source links to stored article', link.href === 'https://example.com/article');
t.ok('external links protected', link.rel.includes('noopener'));
t.ok('unsafe source URL excluded', d.querySelectorAll('.brief-sources a').length === 1);
t.ok('fallback clearly labeled', d.querySelector('.brief-fallback').textContent.includes('Source headline'));
t.ok('event coverage shown', d.querySelector('.brief-sources').textContent.includes('2 articles'));
t.ok('timestamp available', !!d.querySelector('time').dateTime);
t.ok('reused news timestamp visible', d.querySelector('.brief-sub').textContent.includes('News updated'));
t.ok('source rows visible', w.getComputedStyle(d.querySelector('.brief-sources')).display === 'flex');
t.done();

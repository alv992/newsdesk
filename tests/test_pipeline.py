"""Offline regression tests: uv run --with httpx --with feedparser --with langdetect python -m unittest discover -s tests -p 'test_*.py'"""
import unittest
from datetime import datetime, timezone
from unittest.mock import patch, Mock
import fetch
import summarise


def article(id='a', title='Central bank holds interest rates steady', **kw):
    return dict(id=id, title=title, summary='Officials say inflation remains persistent.',
                published=kw.pop('published', '2026-08-31T12:00:00+00:00'),
                source=kw.pop('source', 'Wire'), url='https://example.com/'+id,
                category='economic-finance', tier=1, **kw)


class ClassificationTests(unittest.TestCase):
    def setUp(self):
        self.rules = fetch.load_categories()

    def classify(self, title, preview='', topic=None):
        return fetch.classify(title, preview, self.rules, 'world', topic)

    def test_financial_action_beats_company(self):
        category, info = self.classify('Nvidia shares fall after earnings disappoint')
        self.assertEqual(category, 'economic-finance')
        self.assertGreater(info['scores'][category], info['scores']['technology'])

    def test_title_beats_incidental_preview(self):
        self.assertEqual(self.classify('El BCE debate los tipos de interés', 'También se habló del cambio climático.')[0], 'economic-finance')

    def test_repetition_does_not_inflate_score(self):
        self.assertEqual(self.classify('Nvidia')[1]['scores'], self.classify('Nvidia Nvidia Nvidia')[1]['scores'])

    def test_longest_phrase_once(self):
        _, info = self.classify('A new gene therapy trial')
        hits = info['evidence']['science']
        self.assertEqual([h['term'] for h in hits], ['gene therapy'])

    def test_file_order_not_priority(self):
        result = self.classify('Nvidia earnings')[0]
        self.assertEqual(fetch.classify('Nvidia earnings', '', list(reversed(self.rules)), 'world', None)[0], result)

    def test_single_category_and_nepal_geography(self):
        story = article(title='El rescate en Nepal avanza', source='El País')
        story['summary'] = ''
        fetch.retag(story, self.rules, {'El País': {'region': 'spain'}})
        self.assertEqual(story['countries'], ['NP'])
        self.assertEqual(story['category'], 'geopolitics')
        self.assertIsInstance(story['category'], str)

    def test_broad_feed_not_finance(self):
        story = article(title='Nepal rescue effort intensifies', source='FT')
        story['summary'] = ''
        fetch.retag(story, self.rules, {'FT': {'region': 'world', 'category': 'economic-finance', 'topic_hint': False}})
        self.assertEqual(story['category'], 'geopolitics')

    def test_preview_markup_related_and_entities(self):
        raw = '<p>Title</p><p>Espa&ntilde;a crece.</p><aside>AI climate change</aside><div class="related-story"><a>Read this</a></div><p>Second sentence.</p>'
        self.assertEqual(fetch.clean(raw, 'Title'), 'España crece. Second sentence.')

    @patch('fetch.httpx.get')
    def test_search_feed_preserves_actual_publisher(self, get):
        get.return_value = Mock(content=b"""<rss version="2.0"><channel><title>Search</title><item>
        <title>Inflation falls</title><link>https://example.com/item</link>
        <pubDate>Mon, 31 Aug 2026 12:00:00 GMT</pubDate>
        <source url="https://publisher.example">Actual publisher</source>
        <description>Consumer prices slow.</description></item></channel></rss>""")
        _, stories, error = fetch.fetch_one(({'name':'Eurostat', 'url':'https://news.google.com/rss/search?q=Eurostat', 'tier':1, 'category':'economic-finance'}, self.rules))
        self.assertIsNone(error)
        self.assertEqual(stories[0]['source'], 'Actual publisher')
        self.assertEqual(stories[0]['feed'], 'Eurostat')
        self.assertEqual(stories[0]['tier'], 3)
        self.assertEqual(stories[0]['category'], 'economic-finance')

    def test_preview_sentence_boundary_and_no_repeated_title(self):
        self.assertEqual(fetch.clean('Title. First sentence. Second sentence. Third sentence.', 'Title'), 'First sentence. Second sentence.')
        text = fetch.clean('Short sentence. ' + 'word '*150)
        self.assertEqual(text, 'Short sentence.')


class BriefTests(unittest.TestCase):
    def test_newest_before_source_tier(self):
        older = article('old', published='2026-08-31T08:00:00+00:00')
        newer = article('new', title='A separate new development', published='2026-08-31T13:00:00+00:00')
        newer['tier'] = 3
        self.assertEqual(summarise.select_events([older, newer])[0][0]['id'], 'new')

    def test_duplicate_coverage_one_event(self):
        a = article(); b = article('b', title=a['title']+' - Reuters')
        groups = summarise.select_events([a,b])
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 2)

    def test_distinct_events_not_merged_on_company(self):
        self.assertEqual(len(summarise.select_events([article(title='Nvidia opens new research laboratory'), article('b', title='Nvidia shares fall after earnings disappoint')])), 2)

    def test_reject_invalid_source_language_and_number(self):
        valid = {'event_id':'a', 'source_ids':['a'], 'text':'The central bank held interest rates steady, citing persistent inflation.'}
        self.assertEqual(summarise.validate_point(valid, article()), valid['text'])
        for changes in [{'source_ids':['invented']}, {'text':'El banco central mantiene los tipos de interés ante una inflación persistente.'}, {'text':'The central bank raised interest rates to 12 percent.'}]:
            with self.assertRaises(ValueError):
                summarise.validate_point(valid | changes, article())

    @patch('summarise.httpx.post')
    def test_invalid_model_output_retries_then_headline_fallback(self, post):
        post.return_value = Mock(json=lambda: {'response':'{}'})
        result = summarise.summarize_event([article()])
        self.assertEqual(post.call_count, 2)
        self.assertEqual(result['status'], 'headline-fallback')
        self.assertEqual(result['text'], article()['title'])
        self.assertEqual(result['sources'][0]['url'], article()['url'])

    @patch('summarise.httpx.post')
    def test_unavailable_model_falls_back_without_retry(self, post):
        import httpx
        post.side_effect = httpx.ConnectError('unavailable')
        result = summarise.summarize_event([article()])
        self.assertEqual(post.call_count, 1)
        self.assertEqual(result['status'], 'headline-fallback')

    @patch('summarise.httpx.post')
    def test_structured_success(self, post):
        import json
        post.return_value = Mock(json=lambda: {'response': json.dumps({'event_id':'a', 'source_ids':['a'], 'text':'The central bank held interest rates steady, citing persistent inflation.'})})
        result = summarise.summarize_event([article()])
        self.assertEqual(result['status'], 'summarized')
        self.assertIn('format', post.call_args.kwargs['json'])
        self.assertIn(article()['summary'], post.call_args.kwargs['json']['prompt'])

    @patch('summarise.summarize_event')
    def test_category_grouping_excludes_future_old_reports_social(self, generate):
        generate.side_effect = lambda group: {'text':group[0]['title'], 'status':'summarized'}
        stories = [article(), article('old', published='2026-08-20T00:00:00+00:00'), article('future', published='2026-09-01T00:00:00+00:00'), article('report', kind='report')]
        social = article('social');social['tier']=4;stories.append(social)
        out = summarise.news_section({'categories':[], 'stories':stories}, datetime(2026,8,31,15,tzinfo=timezone.utc))
        self.assertEqual(len(out),1)
        self.assertEqual(out[0]['count'],1)
        self.assertEqual(generate.call_count,1)

if __name__ == '__main__':
    unittest.main()

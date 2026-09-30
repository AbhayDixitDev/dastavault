/** Starting content for new written documents. Plain HTML strings the editor understands. */
export const TEMPLATES = [
  {
    key: 'blank',
    name: 'Blank',
    description: 'Start from nothing.',
    html: '<p></p>',
  },
  {
    key: 'meeting',
    name: 'Meeting notes',
    description: 'Who was there, what was said, what to do next.',
    html: `<h1>Meeting notes</h1>
<p><strong>Date:</strong> </p>
<p><strong>Who was there:</strong> </p>
<h2>What we talked about</h2>
<ul><li><p></p></li></ul>
<h2>Decisions</h2>
<ul><li><p></p></li></ul>
<h2>To do</h2>
<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>`,
  },
  {
    key: 'checklist',
    name: 'Checklist',
    description: 'Tick things off one by one.',
    html: `<h1>Checklist</h1>
<ul data-type="taskList">
<li data-type="taskItem" data-checked="false"><p></p></li>
<li data-type="taskItem" data-checked="false"><p></p></li>
<li data-type="taskItem" data-checked="false"><p></p></li>
</ul>`,
  },
  {
    key: 'letter',
    name: 'Letter',
    description: 'A simple letter layout.',
    html: `<p>[Your name]<br>[Your address]<br>[Date]</p>
<p>[Recipient name]<br>[Recipient address]</p>
<p>Dear [Name],</p>
<p></p>
<p>Yours sincerely,</p>
<p>[Your name]</p>`,
  },
  {
    key: 'agreement',
    name: 'Agreement outline',
    description: 'Headings for a simple agreement between two parties.',
    html: `<h1>Agreement</h1>
<p>This agreement is made on [date] between <strong>[Party A]</strong> and <strong>[Party B]</strong>.</p>
<h2>1. Purpose</h2>
<p></p>
<h2>2. What each side will do</h2>
<p></p>
<h2>3. Payment</h2>
<p></p>
<h2>4. Dates</h2>
<p></p>
<h2>5. Ending the agreement</h2>
<p></p>
<h2>6. Signatures</h2>
<table><tbody>
<tr><th><p>Party A</p></th><th><p>Party B</p></th></tr>
<tr><td><p>Name:</p></td><td><p>Name:</p></td></tr>
<tr><td><p>Signature:</p></td><td><p>Signature:</p></td></tr>
<tr><td><p>Date:</p></td><td><p>Date:</p></td></tr>
</tbody></table>`,
  },
]

export function templateByKey(key) {
  return TEMPLATES.find((t) => t.key === key) || TEMPLATES[0]
}

/**
 * Zone.js flags — must load before `zone.js`.
 * Keep worker message events out of Zone.js so LLM worker traffic does not trigger change detection.
 */
(
  window as Window & { __Zone_ignore_on_properties?: Array<{ target: object; ignoreProperties: string[] }> }
).__Zone_ignore_on_properties = [
  {
    target: Worker.prototype,
    ignoreProperties: ['message', 'onmessage'],
  },
];

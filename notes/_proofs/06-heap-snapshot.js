// 6.11 — plant a leak, take a heap snapshot.
// d8 --expose-gc --allow-natives-syntax 06-heap-snapshot.js
// gc({type:'major-snapshot'}) writes heap.heapsnapshot

const leaked = [];
function LeakyCtor() {
  this.payload = 'LEAK_MARKER_' + 'x'.repeat(64);
}
for (let i = 0; i < 200; i++) leaked.push(new LeakyCtor());

print('planted', leaked.length, 'LeakyCtor objects');
gc({type: 'major-snapshot', filename: 'notes-leak.heapsnapshot'});
print('snapshot written');

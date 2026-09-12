// test/utils/serial_build_cache_test.dart
//
// Plain test() — no FakeAsync, no testWidgets.  Concurrency is driven by real
// Dart Completers so the async queue behaves exactly as in production.
//
// Rule for unhandled-rejection hygiene: always register
//   expectLater(future, throwsA(...))
// BEFORE completing the Completer that unblocks that future; otherwise the
// rejection surfaces before the test framework has a listener.

import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/utils/serial_build_cache.dart';

void main() {
  // -------------------------------------------------------------------------
  // (a) At most 1 build in flight at any moment; FIFO order
  // -------------------------------------------------------------------------
  test('(a) max concurrency == 1 and FIFO build order', () async {
    final cache = SerialBuildCache<int, int>();

    int active = 0;
    bool concurrencyViolation = false;
    final List<int> completionOrder = [];

    final c1 = Completer<int>();
    final c2 = Completer<int>();
    final c3 = Completer<int>();

    Future<int> buildFn(int key, Completer<int> gate) async {
      active++;
      if (active > 1) concurrencyViolation = true;
      final v = await gate.future;
      completionOrder.add(key);
      active--;
      return v;
    }

    final f1 = cache.enqueue(
      key: 1,
      isStale: () => false,
      build: () => buildFn(1, c1),
    );
    final f2 = cache.enqueue(
      key: 2,
      isStale: () => false,
      build: () => buildFn(2, c2),
    );
    final f3 = cache.enqueue(
      key: 3,
      isStale: () => false,
      build: () => buildFn(3, c3),
    );

    // Complete gates in order; each pump lets the chain advance.
    c1.complete(10);
    await Future<void>.delayed(Duration.zero);
    c2.complete(20);
    await Future<void>.delayed(Duration.zero);
    c3.complete(30);

    final results = await Future.wait([f1, f2, f3]);

    expect(concurrencyViolation, isFalse,
        reason: 'more than one build was active simultaneously');
    expect(results, equals([10, 20, 30]));
    expect(completionOrder, equals([1, 2, 3]));
  });

  // -------------------------------------------------------------------------
  // (b) Coalescing: superseded queued request does not invoke build
  // -------------------------------------------------------------------------
  test('(b) coalescing — superseded request never invokes build', () async {
    final cache = SerialBuildCache<int, int>();
    int liveGen = 1;
    int buildCount = 0;
    final c1 = Completer<int>();

    // Enqueue key 4 at gen 1 — let the dequeue check run while liveGen == 1
    // so the build actually starts.
    final f1 = cache.enqueue(
      key: 4,
      isStale: () => liveGen != 1,
      build: () {
        buildCount++;
        return c1.future;
      },
    );
    // Pump once so f1's dequeue check + build() call executes before we
    // advance the generation.
    await Future<void>.delayed(Duration.zero);

    // Advance to gen 2 then gen 3 before completing c1.
    liveGen = 2;
    final f2 = cache.enqueue(
      key: 5,
      isStale: () => liveGen != 2,
      build: () {
        buildCount++;
        return Future<int>.value(5);
      },
    );
    liveGen = 3;
    final f3 = cache.enqueue(
      key: 6,
      isStale: () => liveGen != 3,
      build: () {
        buildCount++;
        return Future<int>.value(6);
      },
    );

    // Register throw expectations BEFORE completing c1 to avoid
    // unhandled-rejection noise.
    final expF1 = expectLater(f1, throwsA(isA<StaleBuildException>()));
    final expF2 = expectLater(f2, throwsA(isA<StaleBuildException>()));

    // Completing c1 triggers the full chain.
    c1.complete(4);

    await expF1;
    await expF2;

    final result3 = await f3;
    expect(result3, equals(6));
    // key 4 built (buildCount=1), key 5 skipped, key 6 built (buildCount=2).
    expect(buildCount, equals(2),
        reason: 'key 5 should never have invoked build');
  });

  // -------------------------------------------------------------------------
  // (c) Cache hit: identical result, build invoked exactly once
  // -------------------------------------------------------------------------
  test('(c) cache hit — build invoked once, same object returned', () async {
    final cache = SerialBuildCache<int, List<int>>();
    int buildCount = 0;
    final canonical = [1, 2, 3];

    final v1 = await cache.enqueue(
      key: 42,
      isStale: () => false,
      build: () {
        buildCount++;
        return Future<List<int>>.value(canonical);
      },
    );

    final v2 = await cache.enqueue(
      key: 42,
      isStale: () => false,
      build: () {
        buildCount++;
        return Future<List<int>>.value([9, 9, 9]); // should never run
      },
    );

    expect(identical(v1, v2), isTrue,
        reason: 'cache hit must return the exact same object');
    expect(buildCount, equals(1));
  });

  // -------------------------------------------------------------------------
  // (d) Stale-after-build: value cached, caller rejects; next caller hits cache
  // -------------------------------------------------------------------------
  test('(d) stale-after-build caches value; fresh re-enqueue is a cache hit',
      () async {
    final cache = SerialBuildCache<int, int>();
    bool stale = false;
    int buildCount = 0;
    final c1 = Completer<int>();

    final f1 = cache.enqueue(
      key: 7,
      isStale: () => stale,
      build: () {
        buildCount++;
        return c1.future;
      },
    );
    // Let build start while stale == false.
    await Future<void>.delayed(Duration.zero);

    // Turn stale on BEFORE completing c1.
    stale = true;

    final expF1 = expectLater(f1, throwsA(isA<StaleBuildException>()));
    c1.complete(100);
    await expF1;

    // Value 100 must be cached despite f1 rejecting.
    stale = false;
    final v2 = await cache.enqueue(
      key: 7,
      isStale: () => stale,
      build: () {
        buildCount++;
        return Future<int>.value(999); // must not be invoked
      },
    );

    expect(v2, equals(100), reason: 'should return cached value from f1');
    expect(buildCount, equals(1), reason: 'second enqueue must be a cache hit');
  });

  // -------------------------------------------------------------------------
  // (e) Error recovery: error propagates; queue stays healthy; next build runs
  // -------------------------------------------------------------------------
  test('(e) build error propagates; queue healthy; next enqueue builds again',
      () async {
    final cache = SerialBuildCache<int, int>();
    int buildCount = 0;

    final f1 = cache.enqueue(
      key: 1,
      isStale: () => false,
      build: () {
        buildCount++;
        return Future<int>.error(Exception('boom'));
      },
    );

    await expectLater(f1, throwsA(isA<Exception>()));
    expect(buildCount, equals(1));

    // Cache must be empty — the next enqueue should build fresh.
    final v2 = await cache.enqueue(
      key: 1,
      isStale: () => false,
      build: () {
        buildCount++;
        return Future<int>.value(42);
      },
    );

    expect(v2, equals(42));
    expect(buildCount, equals(2),
        reason: 'cache must be empty after a build error');
  });

  // -------------------------------------------------------------------------
  // (f) isStale true at dequeue — rejects without invoking build
  // -------------------------------------------------------------------------
  test('(f) isStale=true at dequeue rejects without invoking build', () async {
    final cache = SerialBuildCache<int, int>();
    bool buildInvoked = false;

    final f = cache.enqueue(
      key: 1,
      isStale: () => true,
      build: () {
        buildInvoked = true;
        return Future<int>.value(42);
      },
    );

    await expectLater(f, throwsA(isA<StaleBuildException>()));
    expect(buildInvoked, isFalse);
  });
}

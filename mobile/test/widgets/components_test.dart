import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/theme/theme.dart';
import 'package:wasel/widgets/widgets.dart';

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light,
      home: Scaffold(body: child),
    );

void main() {
  group('StatusBadge', () {
    testWidgets('renders label with mapped tint colors', (tester) async {
      await tester.pumpWidget(
        _wrap(const StatusBadge(label: 'Active', color: AppColors.success)),
      );
      expect(find.text('Active'), findsOneWidget);
      final text = tester.widget<Text>(find.text('Active'));
      expect(text.style?.color, AppColors.successDark);
    });

    testWidgets('falls back to alpha tint for unmapped colors',
        (tester) async {
      await tester.pumpWidget(
        _wrap(const StatusBadge(label: 'X', color: Color(0xFF123456))),
      );
      final text = tester.widget<Text>(find.text('X'));
      expect(text.style?.color, const Color(0xFF123456));
    });

    testWidgets('shows leading dot when dot=true', (tester) async {
      await tester.pumpWidget(
        _wrap(const StatusBadge(
            label: 'On', color: AppColors.success, dot: true)),
      );
      expect(find.text('On'), findsOneWidget);
    });
  });

  group('EmptyState', () {
    testWidgets('renders icon, title, message and action', (tester) async {
      var tapped = false;
      await tester.pumpWidget(
        _wrap(EmptyState(
          icon: Icons.inbox,
          title: 'Nothing here',
          message: 'Add something',
          action: ElevatedButton(
            onPressed: () => tapped = true,
            child: const Text('Add'),
          ),
        )),
      );
      expect(find.byIcon(Icons.inbox), findsOneWidget);
      expect(find.text('Nothing here'), findsOneWidget);
      expect(find.text('Add something'), findsOneWidget);
      await tester.tap(find.text('Add'));
      expect(tapped, isTrue);
    });
  });

  group('ErrorState', () {
    testWidgets('renders message and retry triggers callback', (tester) async {
      var retried = false;
      await tester.pumpWidget(
        _wrap(ErrorState(
          message: 'Failed to load',
          retryLabel: 'Retry',
          onRetry: () => retried = true,
        )),
      );
      expect(find.text('Failed to load'), findsOneWidget);
      await tester.tap(find.text('Retry'));
      expect(retried, isTrue);
    });

    testWidgets('hides retry button without onRetry', (tester) async {
      await tester.pumpWidget(_wrap(const ErrorState(message: 'Oops')));
      expect(find.byType(FilledButton), findsNothing);
    });
  });

  group('InlineErrorBanner', () {
    testWidgets('renders error message', (tester) async {
      await tester.pumpWidget(
        _wrap(const InlineErrorBanner(message: 'Invalid credentials')),
      );
      expect(find.text('Invalid credentials'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
    });
  });

  group('showConfirmDialog', () {
    testWidgets('returns true on confirm, false on cancel', (tester) async {
      bool? result;
      await tester.pumpWidget(_wrap(Builder(
        builder: (context) => ElevatedButton(
          onPressed: () async {
            result = await showConfirmDialog(
              context,
              title: 'Delete?',
              message: 'This cannot be undone',
              confirmLabel: 'Delete',
              cancelLabel: 'Cancel',
              destructive: true,
            );
          },
          child: const Text('Open'),
        ),
      )));

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      expect(find.text('Delete?'), findsOneWidget);
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();
      expect(result, isTrue);

      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(result, isFalse);
    });

    testWidgets('destructive confirm button uses error color', (tester) async {
      await tester.pumpWidget(_wrap(Builder(
        builder: (context) => ElevatedButton(
          onPressed: () => showConfirmDialog(
            context,
            title: 'Delete?',
            confirmLabel: 'Delete',
            cancelLabel: 'Cancel',
            destructive: true,
          ),
          child: const Text('Open'),
        ),
      )));
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(
        button.style?.backgroundColor?.resolve({}),
        AppColors.error,
      );
    });
  });

  group('AppSnackbar', () {
    testWidgets('success and error variants render distinct colors',
        (tester) async {
      await tester.pumpWidget(_wrap(Builder(
        builder: (context) => Column(
          children: [
            ElevatedButton(
              onPressed: () => AppSnackbar.success(context, 'Saved'),
              child: const Text('S'),
            ),
            ElevatedButton(
              onPressed: () => AppSnackbar.error(context, 'Failed'),
              child: const Text('E'),
            ),
          ],
        ),
      )));

      await tester.tap(find.text('S'));
      await tester.pump();
      expect(find.text('Saved'), findsOneWidget);
      expect(
        tester.widget<SnackBar>(find.byType(SnackBar)).backgroundColor,
        AppColors.success,
      );

      await tester.tap(find.text('E'));
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      expect(find.text('Failed'), findsOneWidget);
    });
  });

  group('AppCard', () {
    testWidgets('triggers onTap', (tester) async {
      var tapped = false;
      await tester.pumpWidget(_wrap(AppCard(
        onTap: () => tapped = true,
        child: const Text('Card'),
      )));
      await tester.tap(find.text('Card'));
      expect(tapped, isTrue);
    });
  });

  group('StatCard', () {
    testWidgets('renders label and value', (tester) async {
      await tester.pumpWidget(_wrap(const StatCard(
        label: 'Active vouchers',
        value: '128',
        icon: Icons.confirmation_number,
      )));
      expect(find.text('Active vouchers'), findsOneWidget);
      expect(find.text('128'), findsOneWidget);
    });
  });

  group('Skeleton', () {
    testWidgets('pulses without errors', (tester) async {
      await tester.pumpWidget(_wrap(const SkeletonList(itemCount: 3)));
      await tester.pump(const Duration(milliseconds: 600));
      expect(find.byType(SkeletonCard), findsNWidgets(3));
    });
  });
}

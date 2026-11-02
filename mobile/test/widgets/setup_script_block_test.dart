import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wasel/i18n/app_localizations.dart';
import 'package:wasel/services/router_service.dart';
import 'package:wasel/theme/theme.dart';
import 'package:wasel/widgets/setup_script_block.dart';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

List<SetupStep> _makeSteps(List<String> commands) {
  return [
    for (var i = 0; i < commands.length; i++)
      SetupStep(step: i + 1, title: 'Step ${i + 1}', description: '', command: commands[i]),
  ];
}

Widget _wrap(Widget child) => MaterialApp(
      theme: AppTheme.light,
      locale: const Locale('en'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: Scaffold(body: child),
    );

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

void main() {
  // Record clipboard writes.
  final List<String> clipboardWrites = [];

  setUp(() {
    clipboardWrites.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(
      SystemChannels.platform,
      (MethodCall call) async {
        if (call.method == 'Clipboard.setData') {
          final text =
              (call.arguments as Map<dynamic, dynamic>)['text'] as String? ??
                  '';
          clipboardWrites.add(text);
        }
        if (call.method == 'Clipboard.getData') {
          return {'text': clipboardWrites.lastOrNull ?? ''};
        }
        return null;
      },
    );
  });

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null);
  });

  group('SetupScriptBlock', () {
    testWidgets('renders all commands joined by newline', (tester) async {
      final steps = _makeSteps(['/ip route add dst=1.1.1.0', '/system identity set name=test']);
      await tester.pumpWidget(_wrap(SetupScriptBlock(steps: steps)));
      await tester.pumpAndSettle();

      const expected = '/ip route add dst=1.1.1.0\n/system identity set name=test';
      expect(find.text(expected), findsOneWidget);
    });

    testWidgets('copy button puts joined script on clipboard', (tester) async {
      final commands = [
        '/interface wireguard add name=wg-wasel',
        '/interface wireguard peers add interface=wg-wasel',
        '/ip address add address=10.10.0.2/30 interface=wg-wasel',
      ];
      final steps = _makeSteps(commands);
      final expectedScript = commands.join('\n');

      await tester.pumpWidget(_wrap(SetupScriptBlock(steps: steps)));
      await tester.pumpAndSettle();

      // Tap the copy button (labelled by 'routers.copySetupCommand' → 'Copy setup command').
      await tester.tap(find.text('Copy setup command'));
      // pump once to let the async Clipboard.setData resolve.
      await tester.pump();

      expect(clipboardWrites, isNotEmpty);
      expect(clipboardWrites.last, equals(expectedScript));

      // Drain the 2-minute auto-clear timer so the test framework does not
      // complain about a pending Timer after the widget tree is disposed.
      await tester.pump(const Duration(minutes: 3));
    });

    testWidgets('shows paste hint text', (tester) async {
      final steps = _makeSteps(['/ip route add dst=1.1.1.0']);
      await tester.pumpWidget(_wrap(SetupScriptBlock(steps: steps)));
      await tester.pumpAndSettle();

      // The hint key resolves to the EN string from app_localizations.
      expect(
        find.textContaining('WinBox'),
        findsAtLeastNWidgets(1),
      );
    });

    testWidgets('copy button shows snackbar on success', (tester) async {
      final steps = _makeSteps(['/ip route add dst=1.1.1.0']);
      await tester.pumpWidget(_wrap(SetupScriptBlock(steps: steps)));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Copy setup command'));
      // pump once for clipboard future + snackbar.
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Snackbar text is the EN value for 'routers.setupCommandCopied'.
      expect(
        find.textContaining('Copied'),
        findsAtLeastNWidgets(1),
      );

      // Advance past the 2-minute auto-clear timer so the test framework
      // does not complain about a pending Timer after dispose.
      await tester.pump(const Duration(minutes: 3));
    });
  });
}

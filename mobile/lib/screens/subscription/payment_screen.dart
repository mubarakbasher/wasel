import 'dart:async';
import 'dart:io';
import 'dart:ui';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../services/secure_window.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';

import '../../i18n/app_localizations.dart';
import '../../models/bank_info.dart';
import '../../providers/subscription_provider.dart';
import '../../services/subscription_service.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key});

  @override
  ConsumerState<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends ConsumerState<PaymentScreen>
    with WidgetsBindingObserver {
  int _currentStep = 0;
  File? _receiptFile;

  // Tracks whether the screen is currently blurred (iOS inactive state).
  bool _obscured = false;

  // ---------------------------------------------------------------------------
  // Approval poller (Fix 4)
  // ---------------------------------------------------------------------------
  static const _kPollInterval = Duration(seconds: 15);
  static const _kPollTimeout = Duration(minutes: 5);
  Timer? _pollTimer;
  Timer? _pollTimeoutTimer;
  bool _pollTimedOut = false;
  bool _snackBarShown = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // Android: prevent screenshots and screen recording for this screen.
    if (Platform.isAndroid) {
      SecureWindow.enable();
    }
    Future.microtask(
      () => ref.read(subscriptionProvider.notifier).loadBankInfo(),
    );
  }

  @override
  void dispose() {
    _stopPoller();
    WidgetsBinding.instance.removeObserver(this);
    if (Platform.isAndroid) {
      SecureWindow.disable();
    }
    super.dispose();
  }

  void _startPoller() {
    _pollTimer?.cancel();
    _pollTimeoutTimer?.cancel();
    _snackBarShown = false;
    _pollTimedOut = false;

    // Schedule a one-shot timer that fires after the 5-min cap.
    _pollTimeoutTimer = Timer(_kPollTimeout, () {
      if (!mounted) return;
      _stopPoller();
      setState(() => _pollTimedOut = true);
    });

    _pollTimer = Timer.periodic(_kPollInterval, (_) async {
      if (!mounted) return;
      await ref.read(subscriptionProvider.notifier).loadSubscription();
      if (!mounted) return;
      final sub = ref.read(subscriptionProvider).subscription;
      if (sub?.isActive ?? false) {
        _stopPoller();
        if (!_snackBarShown) {
          _snackBarShown = true;
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(
              content: Text(context.tr('payment.subscriptionActivated')),
              duration: const Duration(seconds: 3),
            ),
          );
        }
        await Future.delayed(const Duration(seconds: 1));
        if (mounted) context.go('/dashboard');
      }
    });
  }

  void _stopPoller() {
    _pollTimer?.cancel();
    _pollTimer = null;
    _pollTimeoutTimer?.cancel();
    _pollTimeoutTimer = null;
  }

  /// iOS blur overlay: shown when the app enters the app switcher / goes
  /// inactive so the screen content is not captured in the OS thumbnail.
  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (!Platform.isIOS) return;
    if (state == AppLifecycleState.inactive ||
        state == AppLifecycleState.paused) {
      if (mounted) setState(() => _obscured = true);
    } else if (state == AppLifecycleState.resumed) {
      if (mounted) setState(() => _obscured = false);
    }
  }

  Future<void> _pickReceipt(ImageSource source) async {
    final picker = ImagePicker();
    final XFile? picked = await picker.pickImage(
      source: source,
      maxWidth: 2000,
      imageQuality: 85,
    );
    if (picked == null) return;
    if (!mounted) return;
    setState(() {
      _receiptFile = File(picked.path);
    });
  }

  Future<void> _showSourcePicker() async {
    await showModalBottomSheet<void>(
      context: context,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt, color: AppColors.primary),
              title: Text(context.tr('payment.takePhoto')),
              onTap: () {
                Navigator.pop(ctx);
                _pickReceipt(ImageSource.camera);
              },
            ),
            ListTile(
              leading: const Icon(Icons.photo_library, color: AppColors.primary),
              title: Text(context.tr('payment.pickFromGallery')),
              onTap: () {
                Navigator.pop(ctx);
                _pickReceipt(ImageSource.gallery);
              },
            ),
            const SizedBox(height: AppSpacing.md),
          ],
        ),
      ),
    );
  }

  Future<void> _handleUpload() async {
    final request = ref.read(subscriptionProvider).lastRequest;
    if (request == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('payment.noPendingPayment'))),
      );
      return;
    }
    if (_receiptFile == null) return;

    final success = await ref.read(subscriptionProvider.notifier).uploadReceipt(
          paymentId: request.paymentId,
          file: _receiptFile!,
        );

    if (success && mounted) {
      setState(() => _currentStep = 2);
      _startPoller();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(subscriptionProvider);
    final request = state.lastRequest;
    final sub = state.subscription;

    return Stack(
      children: [
        Scaffold(
          appBar: AppBar(
            title: Text(context.tr('payment.title')),
            leading: IconButton(
              icon: const Icon(Icons.arrow_back),
              onPressed: () => context.go('/subscription'),
            ),
          ),
          body: _buildStepper(state, request, sub),
        ),
        // iOS: blur the screen when app becomes inactive (switcher thumbnail).
        if (_obscured)
          Positioned.fill(
            child: BackdropFilter(
              filter: ImageFilter.blur(sigmaX: 20, sigmaY: 20),
              child: Container(color: Colors.black.withValues(alpha: 0.4)),
            ),
          ),
      ],
    );
  }

  Widget _buildStepper(
    SubscriptionState state,
    SubscriptionRequestResult? request,
    dynamic sub,
  ) {
    return Stepper(
        currentStep: _currentStep,
        type: StepperType.vertical,
        onStepContinue: () {
          if (_currentStep == 0) {
            setState(() => _currentStep = 1);
          } else if (_currentStep == 1) {
            _handleUpload();
          }
        },
        onStepCancel: () {
          if (_currentStep > 0 && _currentStep < 2) {
            setState(() => _currentStep -= 1);
          }
        },
        controlsBuilder: (context, details) {
          if (_currentStep == 2) return const SizedBox.shrink();
          return Padding(
            padding: const EdgeInsets.only(top: AppSpacing.lg),
            child: Row(
              children: [
                Expanded(
                  child: SizedBox(
                    height: 48,
                    child: ElevatedButton(
                      onPressed: _currentStep == 1 &&
                              (state.isLoading || _receiptFile == null)
                          ? null
                          : details.onStepContinue,
                      child: state.isLoading && _currentStep == 1
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : Text(
                              _currentStep == 0
                                  ? context.tr('common.continue_')
                                  : context.tr('payment.submitReceipt'),
                            ),
                    ),
                  ),
                ),
                if (_currentStep == 1) ...[
                  const SizedBox(width: AppSpacing.md),
                  Expanded(
                    child: SizedBox(
                      height: 48,
                      child: OutlinedButton(
                        onPressed: details.onStepCancel,
                        child: Text(context.tr('common.back')),
                      ),
                    ),
                  ),
                ],
              ],
            ),
          );
        },
        steps: [
          Step(
            title: Text(context.tr('payment.stepBankDetails')),
            isActive: _currentStep >= 0,
            state: _currentStep > 0 ? StepState.complete : StepState.indexed,
            content: _buildBankDetails(sub?.planName, request, state.bankInfo),
          ),
          Step(
            title: Text(context.tr('payment.stepUploadReceipt')),
            isActive: _currentStep >= 1,
            state: _currentStep > 1
                ? StepState.complete
                : _currentStep == 1
                    ? StepState.indexed
                    : StepState.disabled,
            content: _buildUploadStep(state),
          ),
          Step(
            title: Text(context.tr('payment.stepSuccess')),
            isActive: _currentStep >= 2,
            state: _currentStep >= 2 ? StepState.complete : StepState.disabled,
            content: _buildSuccessStep(),
          ),
        ],
      );
  }

  Widget _buildBankDetails(
    String? planName,
    SubscriptionRequestResult? request,
    BankInfo? bankInfo,
  ) {
    final hasBankInfo = bankInfo != null && bankInfo.isConfigured;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(AppSpacing.md),
          decoration: BoxDecoration(
            color: AppColors.primaryLight,
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
          ),
          child: Row(
            children: [
              const Icon(Icons.info_outline,
                  color: AppColors.primary, size: 20),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  context.tr('payment.bankTransferInfo'),
                  style: AppTypography.footnote.copyWith(
                    color: AppColors.primaryDark,
                  ),
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.lg),
        Text(context.tr('payment.paymentDetails'),
            style: AppTypography.headline),
        const SizedBox(height: AppSpacing.md),
        if (planName != null)
          _DetailRow(
              label: context.tr('payment.plan'), value: planName),
        if (request != null) ...[
          const SizedBox(height: AppSpacing.md),
          _DetailRow(
            label: context.tr('payment.amount'),
            value:
                '${request.currency} ${request.amount.toStringAsFixed(2)}',
          ),
          const SizedBox(height: AppSpacing.md),
          _CopyableRow(
            label: context.tr('payment.referenceCode'),
            value: request.referenceCode,
          ),
        ],
        const SizedBox(height: AppSpacing.lg),
        const Divider(height: 1),
        const SizedBox(height: AppSpacing.lg),
        Text(context.tr('payment.bankDetails'),
            style: AppTypography.headline),
        const SizedBox(height: AppSpacing.sm),
        if (!hasBankInfo)
          _DetailRow(
            label: context.tr('payment.bank'),
            value: context.tr('payment.bankNotConfigured'),
          )
        else ...[
          _DetailRow(
            label: context.tr('payment.bank'),
            value: bankInfo.bankName,
          ),
          const SizedBox(height: AppSpacing.sm),
          _CopyableRow(
            label: context.tr('payment.accountNumber'),
            value: bankInfo.accountNumber,
          ),
          const SizedBox(height: AppSpacing.sm),
          _DetailRow(
            label: context.tr('payment.accountHolder'),
            value: bankInfo.accountHolder,
          ),
          if (bankInfo.instructions.trim().isNotEmpty) ...[
            const SizedBox(height: AppSpacing.md),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.md),
              decoration: BoxDecoration(
                color: AppColors.primaryLight,
                borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                border: Border.all(color: AppColors.border),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    context.tr('payment.transferInstructions'),
                    style: AppTypography.footnote.copyWith(
                      fontWeight: FontWeight.w600,
                      color: AppColors.primaryDark,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    bankInfo.instructions,
                    style: AppTypography.footnote.copyWith(
                      color: AppColors.primaryDark,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
        const SizedBox(height: AppSpacing.sm),
        Text(
          context.tr('payment.includeReference'),
          style: AppTypography.footnote,
        ),
      ],
    );
  }

  Widget _buildUploadStep(SubscriptionState state) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          context.tr('payment.receiptPhotoDesc'),
          style: AppTypography.footnote,
        ),
        const SizedBox(height: AppSpacing.lg),
        if (_receiptFile != null) ...[
          ClipRRect(
            borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
            child: Image.file(
              _receiptFile!,
              height: 220,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(height: AppSpacing.md),
          OutlinedButton.icon(
            onPressed: _showSourcePicker,
            icon: const Icon(Icons.refresh),
            label: Text(context.tr('payment.changePhoto')),
          ),
        ] else ...[
          SizedBox(
            height: 140,
            child: OutlinedButton.icon(
              onPressed: _showSourcePicker,
              icon: const Icon(Icons.add_a_photo, size: 32),
              label: Text(context.tr('payment.selectReceiptPhoto')),
              style: OutlinedButton.styleFrom(
                side: BorderSide(
                    color: AppColors.border, style: BorderStyle.solid),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
              ),
            ),
          ),
        ],
        if (state.error != null) ...[
          const SizedBox(height: AppSpacing.md),
          Container(
            padding: const EdgeInsets.all(AppSpacing.md),
            decoration: BoxDecoration(
              color: AppColors.errorLight,
              borderRadius: BorderRadius.circular(AppSpacing.radiusSm),
            ),
            child: Row(
              children: [
                const Icon(Icons.error_outline,
                    color: AppColors.error, size: 20),
                const SizedBox(width: AppSpacing.sm),
                Expanded(
                  child: Text(
                    state.error!,
                    style: AppTypography.footnote.copyWith(
                      color: AppColors.error,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }

  Widget _buildSuccessStep() {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Center(
          child: Column(
            children: [
              const Icon(Icons.check_circle, size: 72, color: AppColors.success),
              const SizedBox(height: AppSpacing.md),
              Text(
                context.tr('payment.receiptSubmitted'),
                style: AppTypography.title2,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                context.tr('payment.receiptSubmittedDesc'),
                style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
        const SizedBox(height: AppSpacing.xxl),
        // Approval-wait card
        _pollTimedOut
            ? _buildPollTimedOut()
            : _buildPollWaiting(),
        const SizedBox(height: AppSpacing.lg),
        SizedBox(
          height: 48,
          child: OutlinedButton(
            onPressed: () {
              _stopPoller();
              context.go('/settings');
            },
            child: Text(context.tr('payment.doneForNow')),
          ),
        ),
      ],
    );
  }

  Widget _buildPollWaiting() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.primaryLight,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const SizedBox(
                width: 18,
                height: 18,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  context.tr('payment.waitingApproval'),
                  style: AppTypography.subhead.copyWith(fontWeight: FontWeight.w600),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            context.tr('payment.waitingApprovalDesc'),
            style: AppTypography.footnote.copyWith(color: AppColors.textSecondary),
          ),
          const SizedBox(height: AppSpacing.md),
          SizedBox(
            width: double.infinity,
            height: 40,
            child: OutlinedButton(
              onPressed: () async {
                await ref.read(subscriptionProvider.notifier).loadSubscription();
                if (!mounted) return;
                final sub = ref.read(subscriptionProvider).subscription;
                if (sub?.isActive ?? false) {
                  _stopPoller();
                  if (!_snackBarShown) {
                    _snackBarShown = true;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(context.tr('payment.subscriptionActivated')),
                        duration: const Duration(seconds: 3),
                      ),
                    );
                  }
                  await Future.delayed(const Duration(seconds: 1));
                  if (mounted) context.go('/dashboard');
                }
              },
              child: Text(context.tr('payment.refreshNow')),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildPollTimedOut() {
    return Container(
      padding: const EdgeInsets.all(AppSpacing.lg),
      decoration: BoxDecoration(
        color: AppColors.surface,
        borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
        border: Border.all(color: AppColors.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            context.tr('payment.stillPending'),
            style: AppTypography.subhead.copyWith(fontWeight: FontWeight.w600),
          ),
          const SizedBox(height: AppSpacing.sm),
          Text(
            context.tr('payment.stillPendingDesc'),
            style: AppTypography.footnote.copyWith(color: AppColors.textSecondary),
          ),
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  final String label;
  final String value;

  const _DetailRow({required this.label, required this.value});

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: AppTypography.subhead
              .copyWith(color: AppColors.textSecondary),
        ),
        Text(
          value,
          style:
              AppTypography.subhead.copyWith(fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}

/// A row that copies [value] to the clipboard and schedules an auto-clear
/// after 30 seconds (only if the clipboard still contains our value).
class _CopyableRow extends StatefulWidget {
  final String label;
  final String value;

  const _CopyableRow({required this.label, required this.value});

  @override
  State<_CopyableRow> createState() => _CopyableRowState();
}

class _CopyableRowState extends State<_CopyableRow> {
  Timer? _clearTimer;

  @override
  void dispose() {
    _clearTimer?.cancel();
    super.dispose();
  }

  Future<void> _copyWithAutoClear() async {
    await Clipboard.setData(ClipboardData(text: widget.value));
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(context.tr('payment.referenceCopied')),
        duration: const Duration(seconds: 2),
      ),
    );
    _clearTimer?.cancel();
    _clearTimer = Timer(const Duration(seconds: 30), () async {
      final current = await Clipboard.getData('text/plain');
      if (current?.text == widget.value) {
        await Clipboard.setData(const ClipboardData(text: ''));
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          widget.label,
          style: AppTypography.subhead
              .copyWith(color: AppColors.textSecondary),
        ),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(
              widget.value,
              style: AppTypography.subhead.copyWith(
                fontWeight: FontWeight.w700,
                color: AppColors.primary,
              ),
            ),
            const SizedBox(width: AppSpacing.xs),
            GestureDetector(
              onTap: _copyWithAutoClear,
              child: const Icon(Icons.copy,
                  size: 18, color: AppColors.primary),
            ),
          ],
        ),
      ],
    );
  }
}

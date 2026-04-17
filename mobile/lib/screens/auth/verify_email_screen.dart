import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';
import '../../utils/validators.dart';

class VerifyEmailScreen extends ConsumerStatefulWidget {
  final String email;
  const VerifyEmailScreen({super.key, required this.email});

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  final _formKey = GlobalKey<FormState>();
  final _otpController = TextEditingController();
  int _resendCooldown = 0;
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _startCooldown();
    _otpController.addListener(_clearError);
  }

  void _clearError() {
    if (ref.read(authProvider).error != null) {
      ref.read(authProvider.notifier).clearError();
    }
  }

  void _startCooldown() {
    _resendCooldown = 60;
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        _resendCooldown--;
        if (_resendCooldown <= 0) timer.cancel();
      });
    });
  }

  Future<void> _verify() async {
    if (!_formKey.currentState!.validate()) return;
    try {
      await ref.read(authProvider.notifier).verifyEmail(
            email: widget.email,
            otp: _otpController.text.trim(),
          );
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('auth.emailVerifiedSuccess')), backgroundColor: AppColors.success),
        );
        context.go('/login');
      }
    } catch (_) {}
  }

  Future<void> _resend() async {
    try {
      await ref.read(authProvider.notifier).resendVerification(email: widget.email);
      _startCooldown();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(context.tr('auth.verificationResent')), backgroundColor: AppColors.success),
        );
      }
    } catch (_) {}
  }

  @override
  void dispose() {
    _timer?.cancel();
    _otpController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(backgroundColor: Colors.transparent, elevation: 0),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: AppSpacing.xl),
                const Icon(Icons.mark_email_read_outlined, size: 64, color: AppColors.primary),
                const SizedBox(height: AppSpacing.xxl),
                Text(context.tr('auth.verifyEmail'), style: AppTypography.title1, textAlign: TextAlign.center),
                const SizedBox(height: AppSpacing.sm),
                Text(
                  context.tr('auth.enterOtpSent', [widget.email]),
                  style: AppTypography.subhead.copyWith(color: AppColors.textSecondary),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.xxxl),

                // Error
                if (authState.error != null) ...[
                  Container(
                    padding: const EdgeInsets.all(AppSpacing.md),
                    decoration: BoxDecoration(color: AppColors.errorLight, borderRadius: BorderRadius.circular(AppSpacing.sm)),
                    child: Row(
                      children: [
                        const Icon(Icons.error_outline, color: AppColors.error, size: 20),
                        const SizedBox(width: AppSpacing.sm),
                        Expanded(child: Text(authState.error!, style: AppTypography.footnote.copyWith(color: AppColors.error))),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                ],

                // OTP field
                TextFormField(
                  controller: _otpController,
                  keyboardType: TextInputType.number,
                  textAlign: TextAlign.center,
                  maxLength: 6,
                  style: AppTypography.title1.copyWith(letterSpacing: 12),
                  decoration: InputDecoration(
                    hintText: context.tr('auth.otpHint'),
                    counterText: '',
                  ),
                  validator: Validators.validateOtp,
                  onFieldSubmitted: (_) => _verify(),
                ),
                const SizedBox(height: AppSpacing.xxl),

                // Verify button
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: authState.isLoading ? null : _verify,
                    child: authState.isLoading
                        ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : Text(context.tr('auth.verify')),
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),

                // Resend
                Center(
                  child: TextButton(
                    onPressed: _resendCooldown > 0 || authState.isLoading ? null : _resend,
                    child: Text(
                      _resendCooldown > 0 ? context.tr('auth.resendOtpCountdown', [_resendCooldown.toString()]) : context.tr('auth.resendOtp'),
                      style: AppTypography.footnote.copyWith(
                        color: _resendCooldown > 0 ? AppColors.textTertiary : AppColors.primary,
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

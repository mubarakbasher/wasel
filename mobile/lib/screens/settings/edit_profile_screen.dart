import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../providers/auth_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../utils/validators.dart';
import '../../widgets/widgets.dart';

class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  final _phoneController = TextEditingController();
  final _businessNameController = TextEditingController();

  @override
  void initState() {
    super.initState();
    final user = ref.read(authProvider).user;
    if (user != null) {
      _nameController.text = user.name;
      _emailController.text = user.email;
      _phoneController.text = user.phone ?? '';
      _businessNameController.text = user.businessName ?? '';
    }
    for (final c in [
      _nameController,
      _emailController,
      _phoneController,
      _businessNameController,
    ]) {
      c.addListener(_clearError);
    }
  }

  void _clearError() {
    if (ref.read(authProvider).error != null) {
      ref.read(authProvider.notifier).clearError();
    }
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    final user = ref.read(authProvider).user;
    final newEmail = _emailController.text.trim().toLowerCase();
    final currentEmail = (user?.email ?? '').toLowerCase();
    final emailChanged = newEmail != currentEmail;

    // Step 1: update profile fields (name, phone, businessName).
    try {
      await ref.read(authProvider.notifier).updateProfile(
            name: _nameController.text.trim(),
            phone: _phoneController.text.trim().isEmpty
                ? null
                : _phoneController.text.trim(),
            businessName: _businessNameController.text.trim().isEmpty
                ? null
                : _businessNameController.text.trim(),
          );
    } catch (_) {
      return; // Error displayed via state banner
    }

    if (!emailChanged) {
      if (mounted) {
        AppSnackbar.success(context, context.tr('settings.profileUpdated'));
        context.pop();
      }
      return;
    }

    // Step 2: initiate email change — sends OTP to the new address.
    try {
      await ref.read(authProvider.notifier).changeEmail(newEmail);
      if (mounted) {
        context.push(
          '/settings/verify-email-change',
          extra: {'newEmail': newEmail},
        );
      }
    } catch (_) {
      // Error displayed via state banner
    }
  }

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _phoneController.dispose();
    _businessNameController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final authState = ref.watch(authProvider);

    return Scaffold(
      appBar: AppBar(title: Text(context.tr('settings.editProfile'))),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.xxl),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SizedBox(height: AppSpacing.xxl),

                // Error display
                if (authState.error != null)
                  InlineErrorBanner(message: authState.error!),

                // Full Name
                TextFormField(
                  controller: _nameController,
                  textInputAction: TextInputAction.next,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: context.tr('auth.fullName'),
                    prefixIcon: const Icon(Icons.person_outlined),
                  ),
                  validator: (v) { final k = Validators.validateName(v); return k != null ? context.tr(k) : null; },
                ),
                const SizedBox(height: AppSpacing.lg),

                // Email (editable — triggers OTP verification on change)
                TextFormField(
                  controller: _emailController,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: context.tr('auth.email'),
                    prefixIcon: const Icon(Icons.email_outlined),
                  ),
                  validator: (v) { final k = Validators.validateEmail(v); return k != null ? context.tr(k) : null; },
                ),
                const SizedBox(height: AppSpacing.lg),

                // Phone
                TextFormField(
                  controller: _phoneController,
                  keyboardType: TextInputType.phone,
                  textInputAction: TextInputAction.next,
                  decoration: InputDecoration(
                    labelText: context.tr('auth.phone'),
                    prefixIcon: const Icon(Icons.phone_outlined),
                    hintText: context.tr('auth.phoneHint'),
                  ),
                  validator: (v) {
                    if (v == null || v.trim().isEmpty) return null;
                    final k = Validators.validatePhone(v);
                    return k != null ? context.tr(k) : null;
                  },
                ),
                const SizedBox(height: AppSpacing.lg),

                // Business Name
                TextFormField(
                  controller: _businessNameController,
                  textInputAction: TextInputAction.done,
                  textCapitalization: TextCapitalization.words,
                  decoration: InputDecoration(
                    labelText: context.tr('auth.businessNameOptional'),
                    prefixIcon: const Icon(Icons.business_outlined),
                  ),
                  onFieldSubmitted: (_) => _submit(),
                ),
                const SizedBox(height: AppSpacing.xxl),

                // Save button
                SizedBox(
                  height: 48,
                  child: ElevatedButton(
                    onPressed: authState.isLoading ? null : _submit,
                    child: authState.isLoading
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(
                              strokeWidth: 2,
                              color: AppColors.textInverse,
                            ),
                          )
                        : Text(context.tr('settings.saveChanges')),
                  ),
                ),
                const SizedBox(height: AppSpacing.xxl),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

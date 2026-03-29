import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../providers/routers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class AddRouterScreen extends ConsumerStatefulWidget {
  const AddRouterScreen({super.key});

  @override
  ConsumerState<AddRouterScreen> createState() => _AddRouterScreenState();
}

class _AddRouterScreenState extends ConsumerState<AddRouterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _modelController = TextEditingController();
  final _rosVersionController = TextEditingController();
  final _apiUserController = TextEditingController();
  final _apiPassController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _nameController.dispose();
    _modelController.dispose();
    _rosVersionController.dispose();
    _apiUserController.dispose();
    _apiPassController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    ref.read(routersProvider.notifier).clearError();

    final success = await ref.read(routersProvider.notifier).createRouter(
          name: _nameController.text.trim(),
          model: _modelController.text.trim().isEmpty
              ? null
              : _modelController.text.trim(),
          rosVersion: _rosVersionController.text.trim().isEmpty
              ? null
              : _rosVersionController.text.trim(),
          apiUser: _apiUserController.text.trim().isEmpty
              ? null
              : _apiUserController.text.trim(),
          apiPass: _apiPassController.text.isEmpty
              ? null
              : _apiPassController.text,
        );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Router created successfully')),
      );
      final router = ref.read(routersProvider).selectedRouter;
      if (router != null) {
        context.pushReplacement('/routers/setup-guide', extra: router.id);
      } else {
        context.pop();
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Add Router')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          children: [
            if (state.error != null) ...[
              Container(
                padding: const EdgeInsets.all(AppSpacing.md),
                decoration: BoxDecoration(
                  color: AppColors.error.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(AppSpacing.radiusMd),
                ),
                child: Text(
                  state.error!,
                  style: AppTypography.subhead.copyWith(color: AppColors.error),
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
            ],
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Router Name *',
                prefixIcon: Icon(Icons.router),
                hintText: 'e.g. Cafe Main Router',
              ),
              validator: (value) {
                if (value == null || value.trim().isEmpty) {
                  return 'Router name is required';
                }
                if (value.trim().length < 2) {
                  return 'Name must be at least 2 characters';
                }
                if (value.trim().length > 100) {
                  return 'Name must be at most 100 characters';
                }
                return null;
              },
              onChanged: (_) => ref.read(routersProvider.notifier).clearError(),
            ),
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: _modelController,
              decoration: const InputDecoration(
                labelText: 'Model',
                prefixIcon: Icon(Icons.devices),
                hintText: 'e.g. hAP ac2',
              ),
              validator: (value) {
                if (value != null && value.length > 100) {
                  return 'Model must be at most 100 characters';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: _rosVersionController,
              decoration: const InputDecoration(
                labelText: 'RouterOS Version',
                prefixIcon: Icon(Icons.system_update),
                hintText: 'e.g. 7.14',
              ),
              validator: (value) {
                if (value != null && value.length > 20) {
                  return 'Version must be at most 20 characters';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: _apiUserController,
              decoration: const InputDecoration(
                labelText: 'API Username',
                prefixIcon: Icon(Icons.person),
                hintText: 'e.g. admin',
              ),
              validator: (value) {
                if (value != null && value.length > 100) {
                  return 'Username must be at most 100 characters';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.lg),
            TextFormField(
              controller: _apiPassController,
              obscureText: _obscurePassword,
              decoration: InputDecoration(
                labelText: 'API Password',
                prefixIcon: const Icon(Icons.lock),
                suffixIcon: IconButton(
                  icon: Icon(
                    _obscurePassword
                        ? Icons.visibility_off
                        : Icons.visibility,
                  ),
                  onPressed: () =>
                      setState(() => _obscurePassword = !_obscurePassword),
                ),
              ),
              validator: (value) {
                if (value != null && value.length > 255) {
                  return 'Password must be at most 255 characters';
                }
                return null;
              },
            ),
            const SizedBox(height: AppSpacing.xxl),
            SizedBox(
              height: 48,
              child: ElevatedButton(
                onPressed: state.isLoading ? null : _submit,
                child: state.isLoading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Add Router'),
              ),
            ),
            const SizedBox(height: AppSpacing.lg),
            Text(
              'After creating the router, you will receive a setup guide with WireGuard and RADIUS configuration for your Mikrotik device.',
              style: AppTypography.footnote,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../i18n/app_localizations.dart';
import '../../providers/routers_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class EditRouterScreen extends ConsumerStatefulWidget {
  final String routerId;

  const EditRouterScreen({super.key, required this.routerId});

  @override
  ConsumerState<EditRouterScreen> createState() => _EditRouterScreenState();
}

class _EditRouterScreenState extends ConsumerState<EditRouterScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _modelController = TextEditingController();
  final _rosVersionController = TextEditingController();
  final _apiUserController = TextEditingController();
  final _apiPassController = TextEditingController();
  bool _obscurePassword = true;
  bool _initialized = false;

  // Original values to detect changes
  String _origName = '';
  String _origModel = '';
  String _origRosVersion = '';
  String _origApiUser = '';

  @override
  void initState() {
    super.initState();
    final router = ref.read(routersProvider).selectedRouter;
    if (router != null && router.id == widget.routerId) {
      _prefill(router);
    } else {
      Future.microtask(
          () => ref.read(routersProvider.notifier).loadRouter(widget.routerId));
    }
  }

  void _prefill(dynamic router) {
    _nameController.text = router.name;
    _modelController.text = router.model ?? '';
    _rosVersionController.text = router.rosVersion ?? '';
    _apiUserController.text = router.apiUser ?? '';

    _origName = router.name;
    _origModel = router.model ?? '';
    _origRosVersion = router.rosVersion ?? '';
    _origApiUser = router.apiUser ?? '';

    _initialized = true;
  }

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

    final name = _nameController.text.trim();
    final model = _modelController.text.trim();
    final rosVersion = _rosVersionController.text.trim();
    final apiUser = _apiUserController.text.trim();
    final apiPass = _apiPassController.text;

    // Only send changed fields
    String? nameParam = name != _origName ? name : null;
    String? modelParam = model != _origModel ? model : null;
    String? rosVersionParam = rosVersion != _origRosVersion ? rosVersion : null;
    String? apiUserParam = apiUser != _origApiUser ? apiUser : null;
    String? apiPassParam = apiPass.isNotEmpty ? apiPass : null;

    if (nameParam == null &&
        modelParam == null &&
        rosVersionParam == null &&
        apiUserParam == null &&
        apiPassParam == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('routers.noChanges'))),
      );
      return;
    }

    ref.read(routersProvider.notifier).clearError();

    final success = await ref.read(routersProvider.notifier).updateRouter(
          widget.routerId,
          name: nameParam,
          model: modelParam,
          rosVersion: rosVersionParam,
          apiUser: apiUserParam,
          apiPass: apiPassParam,
        );

    if (success && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(context.tr('routers.routerUpdated'))),
      );
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(routersProvider);

    // Pre-fill when router loads
    if (!_initialized && state.selectedRouter != null) {
      _prefill(state.selectedRouter!);
      setState(() {});
    }

    return Scaffold(
      appBar: AppBar(title: Text(context.tr('routers.editRouter'))),
      body: state.isLoading && !_initialized
          ? const Center(child: CircularProgressIndicator())
          : Form(
              key: _formKey,
              child: ListView(
                padding: const EdgeInsets.all(AppSpacing.lg),
                children: [
                  if (state.error != null) ...[
                    Container(
                      padding: const EdgeInsets.all(AppSpacing.md),
                      decoration: BoxDecoration(
                        color: AppColors.error.withValues(alpha: 0.1),
                        borderRadius:
                            BorderRadius.circular(AppSpacing.radiusMd),
                      ),
                      child: Text(
                        state.error!,
                        style: AppTypography.subhead
                            .copyWith(color: AppColors.error),
                      ),
                    ),
                    const SizedBox(height: AppSpacing.lg),
                  ],
                  TextFormField(
                    controller: _nameController,
                    decoration: InputDecoration(
                      labelText: '${context.tr('routers.routerName')} *',
                      prefixIcon: const Icon(Icons.router),
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return context.tr('routers.routerNameRequired');
                      }
                      if (value.trim().length < 2) {
                        return context.tr('routers.nameMinLength');
                      }
                      if (value.trim().length > 100) {
                        return context.tr('routers.nameMaxLength');
                      }
                      return null;
                    },
                    onChanged: (_) =>
                        ref.read(routersProvider.notifier).clearError(),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  TextFormField(
                    controller: _modelController,
                    decoration: InputDecoration(
                      labelText: context.tr('routers.model'),
                      prefixIcon: const Icon(Icons.devices),
                    ),
                    validator: (value) {
                      if (value != null && value.length > 100) {
                        return context.tr('routers.modelMaxLength');
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  TextFormField(
                    controller: _rosVersionController,
                    decoration: InputDecoration(
                      labelText: context.tr('routers.rosVersion'),
                      prefixIcon: const Icon(Icons.system_update),
                    ),
                    validator: (value) {
                      if (value != null && value.length > 20) {
                        return context.tr('routers.versionMaxLength');
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  TextFormField(
                    controller: _apiUserController,
                    decoration: InputDecoration(
                      labelText: context.tr('routers.apiUsername'),
                      prefixIcon: const Icon(Icons.person),
                    ),
                    validator: (value) {
                      if (value != null && value.length > 100) {
                        return context.tr('routers.usernameMaxLength');
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  TextFormField(
                    controller: _apiPassController,
                    obscureText: _obscurePassword,
                    decoration: InputDecoration(
                      labelText: context.tr('routers.apiPassword'),
                      prefixIcon: const Icon(Icons.lock),
                      hintText: context.tr('routers.leaveBlank'),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _obscurePassword
                              ? Icons.visibility_off
                              : Icons.visibility,
                        ),
                        onPressed: () => setState(
                            () => _obscurePassword = !_obscurePassword),
                      ),
                    ),
                    validator: (value) {
                      if (value != null && value.length > 255) {
                        return context.tr('routers.passwordMaxLength');
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
                              child:
                                  CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(context.tr('routers.saveChanges')),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}

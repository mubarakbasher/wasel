import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../i18n/app_localizations.dart';
import '../../models/support_message.dart';
import '../../providers/support_provider.dart';
import '../../theme/app_colors.dart';
import '../../theme/app_spacing.dart';
import '../../theme/app_typography.dart';

class ContactScreen extends ConsumerStatefulWidget {
  const ContactScreen({super.key});

  @override
  ConsumerState<ContactScreen> createState() => _ContactScreenState();
}

class _ContactScreenState extends ConsumerState<ContactScreen> {
  final _composerController = TextEditingController();
  final _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    Future.microtask(() async {
      await ref.read(supportProvider.notifier).refresh();
      await ref.read(supportProvider.notifier).markAllRead();
    });
    _scrollController.addListener(_onScroll);
  }

  @override
  void dispose() {
    _composerController.dispose();
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    super.dispose();
  }

  void _onScroll() {
    // Reverse list: load more when user scrolls to the top (oldest end).
    if (_scrollController.position.pixels >=
        _scrollController.position.maxScrollExtent - 200) {
      ref.read(supportProvider.notifier).loadMore();
    }
  }

  Future<void> _handleSend() async {
    final text = _composerController.text;
    if (text.trim().isEmpty) return;
    _composerController.clear();
    final success = await ref.read(supportProvider.notifier).send(text);
    if (!success && mounted) {
      // Restore text so the user can retry.
      _composerController.text = text;
      final error = ref.read(supportProvider).error;
      if (error != null) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(error)),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(supportProvider);

    return Scaffold(
      appBar: AppBar(title: Text(context.tr('contact.title'))),
      body: Column(
        children: [
          Expanded(child: _buildBody(state)),
          _buildComposer(state.isSending),
        ],
      ),
    );
  }

  Widget _buildBody(SupportState state) {
    if (state.isLoading && state.messages.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (state.messages.isEmpty) {
      return _buildEmpty();
    }

    return RefreshIndicator(
      onRefresh: () => ref.read(supportProvider.notifier).refresh(),
      child: ListView.separated(
        controller: _scrollController,
        reverse: true,
        padding: const EdgeInsets.all(AppSpacing.lg),
        itemCount: state.messages.length + (state.hasMore ? 1 : 0),
        separatorBuilder: (_, __) => const SizedBox(height: AppSpacing.sm),
        itemBuilder: (context, index) {
          if (index >= state.messages.length) {
            return const Padding(
              padding: EdgeInsets.all(AppSpacing.md),
              child: Center(child: CircularProgressIndicator()),
            );
          }
          return _MessageBubble(message: state.messages[index]);
        },
      ),
    );
  }

  Widget _buildEmpty() {
    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      children: [
        const SizedBox(height: 120),
        Icon(Icons.support_agent,
            size: 64, color: AppColors.textTertiary),
        const SizedBox(height: AppSpacing.lg),
        Center(
          child: Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: AppSpacing.xl),
            child: Text(
              context.tr('contact.empty'),
              textAlign: TextAlign.center,
              style: AppTypography.subhead
                  .copyWith(color: AppColors.textSecondary),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildComposer(bool sending) {
    return Material(
      color: AppColors.surface,
      elevation: 3,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
              AppSpacing.md, AppSpacing.sm, AppSpacing.sm, AppSpacing.sm),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: TextField(
                  controller: _composerController,
                  maxLines: 4,
                  minLines: 1,
                  maxLength: 2000,
                  textInputAction: TextInputAction.newline,
                  decoration: InputDecoration(
                    hintText: context.tr('contact.composerHint'),
                    border: OutlineInputBorder(
                      borderRadius:
                          BorderRadius.circular(AppSpacing.radiusLg),
                    ),
                    contentPadding: const EdgeInsets.symmetric(
                        horizontal: AppSpacing.md, vertical: AppSpacing.sm),
                    counterText: '',
                  ),
                ),
              ),
              const SizedBox(width: AppSpacing.sm),
              IconButton.filled(
                onPressed: sending ? null : _handleSend,
                icon: sending
                    ? const SizedBox(
                        width: 18,
                        height: 18,
                        child: CircularProgressIndicator(
                            strokeWidth: 2, color: Colors.white),
                      )
                    : const Icon(Icons.send),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MessageBubble extends StatelessWidget {
  final SupportMessage message;

  const _MessageBubble({required this.message});

  String _relativeTime(BuildContext context, DateTime d) {
    final diff = DateTime.now().difference(d);
    if (diff.inSeconds < 60) return context.tr('routers.justNow');
    if (diff.inMinutes < 60) {
      return context.tr('routers.minutesAgo', [diff.inMinutes.toString()]);
    }
    if (diff.inHours < 24) {
      return context.tr('routers.hoursAgo', [diff.inHours.toString()]);
    }
    return context.tr('routers.daysAgo', [diff.inDays.toString()]);
  }

  @override
  Widget build(BuildContext context) {
    final isUser = message.isUser;
    final bg = isUser ? AppColors.primary : AppColors.surface;
    final fg = isUser ? Colors.white : AppColors.textPrimary;
    final align = isUser ? Alignment.centerRight : Alignment.centerLeft;
    final radius = BorderRadius.only(
      topLeft: const Radius.circular(16),
      topRight: const Radius.circular(16),
      bottomLeft: Radius.circular(isUser ? 16 : 4),
      bottomRight: Radius.circular(isUser ? 4 : 16),
    );

    return Align(
      alignment: align,
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.78,
        ),
        child: Container(
          padding: const EdgeInsets.symmetric(
              horizontal: AppSpacing.md, vertical: AppSpacing.sm),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: radius,
            border: isUser ? null : Border.all(color: AppColors.border),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                message.body,
                style: AppTypography.body.copyWith(color: fg),
              ),
              const SizedBox(height: 4),
              Text(
                _relativeTime(context, message.createdAt),
                style: AppTypography.caption1.copyWith(
                  color: isUser
                      ? Colors.white.withValues(alpha: 0.75)
                      : AppColors.textTertiary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

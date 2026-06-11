import 'package:flutter/material.dart';
import '../theme/theme.dart';

/// Canonical Wasel card — white surface, radius 16, soft layered shadow.
///
/// Use this instead of raw [Card] or hand-decorated [Container]s. When [onTap]
/// or [onLongPress] is set the card gets an InkWell ripple.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(AppSpacing.lg),
    this.onTap,
    this.onLongPress,
    this.shadows = AppShadows.sm,
    this.color = AppColors.surface,
    this.borderRadius,
    this.margin,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final VoidCallback? onLongPress;
  final List<BoxShadow> shadows;
  final Color color;
  final BorderRadius? borderRadius;
  final EdgeInsetsGeometry? margin;

  @override
  Widget build(BuildContext context) {
    final radius = borderRadius ?? BorderRadius.circular(AppSpacing.radiusXl);

    Widget content = Padding(padding: padding, child: child);

    if (onTap != null || onLongPress != null) {
      content = Material(
        color: Colors.transparent,
        borderRadius: radius,
        child: InkWell(
          borderRadius: radius,
          onTap: onTap,
          onLongPress: onLongPress,
          child: content,
        ),
      );
    }

    return Container(
      margin: margin,
      decoration: BoxDecoration(
        color: color,
        borderRadius: radius,
        boxShadow: shadows,
      ),
      child: content,
    );
  }
}

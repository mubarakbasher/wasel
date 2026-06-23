import 'package:flutter/material.dart';

import '../theme/app_colors.dart';

/// Shown during the cold-start session-restore pass.
/// Replaced by the router as soon as [AuthState.isInitializing] flips false.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AppColors.background,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Image(
              image: AssetImage('assets/logo/01-wifi-monogram-512.png'),
              width: 120,
              height: 120,
            ),
            SizedBox(height: 24),
            CircularProgressIndicator(
              color: AppColors.primary,
            ),
          ],
        ),
      ),
    );
  }
}

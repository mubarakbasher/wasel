class AppNotification {
  final String id;
  final String category;
  final String title;
  final String body;
  final Map<String, dynamic>? data;
  final DateTime? readAt;
  final DateTime createdAt;

  const AppNotification({
    required this.id,
    required this.category,
    required this.title,
    required this.body,
    required this.data,
    required this.readAt,
    required this.createdAt,
  });

  bool get isUnread => readAt == null;

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        category: json['category'] as String,
        title: json['title'] as String,
        body: json['body'] as String,
        data: json['data'] as Map<String, dynamic>?,
        readAt: json['readAt'] != null
            ? DateTime.parse(json['readAt'] as String)
            : null,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );

  AppNotification copyWith({DateTime? readAt}) => AppNotification(
        id: id,
        category: category,
        title: title,
        body: body,
        data: data,
        readAt: readAt ?? this.readAt,
        createdAt: createdAt,
      );
}

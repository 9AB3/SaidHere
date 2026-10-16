class WallPost {
  const WallPost({
    required this.id,
    required this.wallId,
    required this.body,
    required this.createdAt,
    this.parentId,
    this.replyCount = 0,
  });

  final String id;
  final String wallId;
  final String? parentId;
  final String body;
  final DateTime createdAt;
  final int replyCount;

  bool get isReply => parentId != null;

  factory WallPost.fromMap(Map<String, dynamic> map) {
    return WallPost(
      id: map['id'].toString(),
      wallId: map['wall_id'].toString(),
      parentId: map['parent_id']?.toString(),
      body: (map['body'] ?? '').toString(),
      createdAt: DateTime.parse(map['created_at'].toString()).toLocal(),
      replyCount: (map['reply_count'] as num?)?.toInt() ?? 0,
    );
  }
}

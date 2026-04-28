export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ai_function_bindings: {
        Row: {
          function_key: string
          id: string
          model: string
          provider_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          function_key: string
          id?: string
          model: string
          provider_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          function_key?: string
          id?: string
          model?: string
          provider_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_function_bindings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "ai_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_providers: {
        Row: {
          api_key_encrypted: string
          api_key_last4: string
          base_url: string
          created_at: string
          created_by: string | null
          id: string
          name: string
          note: string | null
          updated_at: string
          vendor: string
        }
        Insert: {
          api_key_encrypted: string
          api_key_last4?: string
          base_url: string
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          note?: string | null
          updated_at?: string
          vendor: string
        }
        Update: {
          api_key_encrypted?: string
          api_key_last4?: string
          base_url?: string
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          note?: string | null
          updated_at?: string
          vendor?: string
        }
        Relationships: []
      }
      application_reviews: {
        Row: {
          action: Database["public"]["Enums"]["review_action"]
          application_id: string
          confidence: number | null
          created_at: string
          credit: number | null
          decision: Database["public"]["Enums"]["application_status"]
          id: string
          matched_rule_id: string | null
          note: string | null
          reviewer_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["review_action"]
          application_id: string
          confidence?: number | null
          created_at?: string
          credit?: number | null
          decision: Database["public"]["Enums"]["application_status"]
          id?: string
          matched_rule_id?: string | null
          note?: string | null
          reviewer_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["review_action"]
          application_id?: string
          confidence?: number | null
          created_at?: string
          credit?: number | null
          decision?: Database["public"]["Enums"]["application_status"]
          id?: string
          matched_rule_id?: string | null
          note?: string | null
          reviewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "applications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "application_reviews_application_id_fkey"
            columns: ["application_id"]
            isOneToOne: false
            referencedRelation: "submission_summary"
            referencedColumns: ["application_id"]
          },
          {
            foreignKeyName: "application_reviews_matched_rule_id_fkey"
            columns: ["matched_rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      applications: {
        Row: {
          ai_blank_fields: string | null
          ai_check_authenticity: boolean | null
          ai_check_completeness: boolean | null
          ai_check_consistency: boolean | null
          ai_check_identity_match: boolean | null
          ai_check_logic: boolean | null
          ai_check_name_match: boolean | null
          ai_check_relevance: boolean | null
          ai_confidence: number | null
          ai_detected_achievement: string | null
          ai_detected_identity: string | null
          ai_detected_level: string | null
          ai_detected_project: string | null
          ai_detected_school: string | null
          ai_detected_student_no: string | null
          ai_identity_mismatch: string | null
          ai_last_attempt_at: string | null
          ai_last_error: string | null
          ai_logic_issue: string | null
          ai_matched_rule_id: string | null
          ai_override_note: string | null
          ai_previous_snapshot: Json | null
          ai_reasoning: string | null
          ai_reasoning_short: string | null
          ai_suggested_credit: number | null
          certificate_issued_at: string | null
          certificate_no: string | null
          created_at: string
          custom_keywords: string[]
          description: string
          face_checked_at: string | null
          face_match_note: string | null
          face_match_score: number | null
          face_match_status: string | null
          file_path: string | null
          final_credit: number | null
          final_review_note: string | null
          final_reviewer_id: string | null
          id: string
          review_source: string | null
          reviewed_at: string | null
          selected_keywords: string[]
          status: Database["public"]["Enums"]["application_status"]
          student_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          ai_blank_fields?: string | null
          ai_check_authenticity?: boolean | null
          ai_check_completeness?: boolean | null
          ai_check_consistency?: boolean | null
          ai_check_identity_match?: boolean | null
          ai_check_logic?: boolean | null
          ai_check_name_match?: boolean | null
          ai_check_relevance?: boolean | null
          ai_confidence?: number | null
          ai_detected_achievement?: string | null
          ai_detected_identity?: string | null
          ai_detected_level?: string | null
          ai_detected_project?: string | null
          ai_detected_school?: string | null
          ai_detected_student_no?: string | null
          ai_identity_mismatch?: string | null
          ai_last_attempt_at?: string | null
          ai_last_error?: string | null
          ai_logic_issue?: string | null
          ai_matched_rule_id?: string | null
          ai_override_note?: string | null
          ai_previous_snapshot?: Json | null
          ai_reasoning?: string | null
          ai_reasoning_short?: string | null
          ai_suggested_credit?: number | null
          certificate_issued_at?: string | null
          certificate_no?: string | null
          created_at?: string
          custom_keywords?: string[]
          description: string
          face_checked_at?: string | null
          face_match_note?: string | null
          face_match_score?: number | null
          face_match_status?: string | null
          file_path?: string | null
          final_credit?: number | null
          final_review_note?: string | null
          final_reviewer_id?: string | null
          id?: string
          review_source?: string | null
          reviewed_at?: string | null
          selected_keywords?: string[]
          status?: Database["public"]["Enums"]["application_status"]
          student_id: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          ai_blank_fields?: string | null
          ai_check_authenticity?: boolean | null
          ai_check_completeness?: boolean | null
          ai_check_consistency?: boolean | null
          ai_check_identity_match?: boolean | null
          ai_check_logic?: boolean | null
          ai_check_name_match?: boolean | null
          ai_check_relevance?: boolean | null
          ai_confidence?: number | null
          ai_detected_achievement?: string | null
          ai_detected_identity?: string | null
          ai_detected_level?: string | null
          ai_detected_project?: string | null
          ai_detected_school?: string | null
          ai_detected_student_no?: string | null
          ai_identity_mismatch?: string | null
          ai_last_attempt_at?: string | null
          ai_last_error?: string | null
          ai_logic_issue?: string | null
          ai_matched_rule_id?: string | null
          ai_override_note?: string | null
          ai_previous_snapshot?: Json | null
          ai_reasoning?: string | null
          ai_reasoning_short?: string | null
          ai_suggested_credit?: number | null
          certificate_issued_at?: string | null
          certificate_no?: string | null
          created_at?: string
          custom_keywords?: string[]
          description?: string
          face_checked_at?: string | null
          face_match_note?: string | null
          face_match_score?: number | null
          face_match_status?: string | null
          file_path?: string | null
          final_credit?: number | null
          final_review_note?: string | null
          final_reviewer_id?: string | null
          id?: string
          review_source?: string | null
          reviewed_at?: string | null
          selected_keywords?: string[]
          status?: Database["public"]["Enums"]["application_status"]
          student_id?: string
          submitted_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "applications_ai_matched_rule_id_fkey"
            columns: ["ai_matched_rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          affected_count: number
          created_at: string
          duration_ms: number | null
          failure_count: number
          id: string
          metadata: Json
          success_count: number
          target_ids: string[]
          target_labels: string[]
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          affected_count?: number
          created_at?: string
          duration_ms?: number | null
          failure_count?: number
          id?: string
          metadata?: Json
          success_count?: number
          target_ids?: string[]
          target_labels?: string[]
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          affected_count?: number
          created_at?: string
          duration_ms?: number | null
          failure_count?: number
          id?: string
          metadata?: Json
          success_count?: number
          target_ids?: string[]
          target_labels?: string[]
        }
        Relationships: []
      }
      cases: {
        Row: {
          awarded_credit: number | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          rule_id: string | null
          summary: string
          title: string
          updated_at: string
        }
        Insert: {
          awarded_credit?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          rule_id?: string | null
          summary: string
          title: string
          updated_at?: string
        }
        Update: {
          awarded_credit?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          rule_id?: string | null
          summary?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cases_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
      cases_backup_20260424: {
        Row: {
          awarded_credit: number | null
          created_at: string | null
          created_by: string | null
          id: string | null
          notes: string | null
          rule_id: string | null
          summary: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          awarded_credit?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          notes?: string | null
          rule_id?: string | null
          summary?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          awarded_credit?: number | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          notes?: string | null
          rule_id?: string | null
          summary?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      certificate_types: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          description: string | null
          id: string
          identity: string | null
          keywords: string[]
          last_synced_at: string
          level: string | null
          name: string
          occurrence_count: number
          source_case_ids: string[]
          source_rule_ids: string[]
          typical_credit: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          identity?: string | null
          keywords?: string[]
          last_synced_at?: string
          level?: string | null
          name: string
          occurrence_count?: number
          source_case_ids?: string[]
          source_rule_ids?: string[]
          typical_credit?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          description?: string | null
          id?: string
          identity?: string | null
          keywords?: string[]
          last_synced_at?: string
          level?: string | null
          name?: string
          occurrence_count?: number
          source_case_ids?: string[]
          source_rule_ids?: string[]
          typical_credit?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      certificate_types_backup_20260424: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string | null
          description: string | null
          id: string | null
          identity: string | null
          keywords: string[] | null
          last_synced_at: string | null
          level: string | null
          name: string | null
          occurrence_count: number | null
          source_case_ids: string[] | null
          source_rule_ids: string[] | null
          typical_credit: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          identity?: string | null
          keywords?: string[] | null
          last_synced_at?: string | null
          level?: string | null
          name?: string | null
          occurrence_count?: number | null
          source_case_ids?: string[] | null
          source_rule_ids?: string[] | null
          typical_credit?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          description?: string | null
          id?: string | null
          identity?: string | null
          keywords?: string[] | null
          last_synced_at?: string | null
          level?: string | null
          name?: string | null
          occurrence_count?: number | null
          source_case_ids?: string[] | null
          source_rule_ids?: string[] | null
          typical_credit?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      keywords: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          keyword: string
          source: string | null
          updated_at: string
          usage_count: number
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          keyword: string
          source?: string | null
          updated_at?: string
          usage_count?: number
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          keyword?: string
          source?: string | null
          updated_at?: string
          usage_count?: number
        }
        Relationships: []
      }
      keywords_backup_20260424: {
        Row: {
          active: boolean | null
          category: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          keyword: string | null
          source: string | null
          updated_at: string | null
          usage_count: number | null
        }
        Insert: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          keyword?: string | null
          source?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Update: {
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          keyword?: string | null
          source?: string | null
          updated_at?: string | null
          usage_count?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          address: string | null
          birth_date: string | null
          class_name: string | null
          created_at: string
          department: string | null
          email: string | null
          emergency_contact: string | null
          emergency_phone: string | null
          enrollment_year: number | null
          full_name: string | null
          gender: string | null
          id: string
          id_card: string | null
          major: string | null
          phone: string | null
          photo_url: string | null
          political_status: string | null
          school: string | null
          student_no: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string | null
          birth_date?: string | null
          class_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          emergency_contact?: string | null
          emergency_phone?: string | null
          enrollment_year?: number | null
          full_name?: string | null
          gender?: string | null
          id?: string
          id_card?: string | null
          major?: string | null
          phone?: string | null
          photo_url?: string | null
          political_status?: string | null
          school?: string | null
          student_no?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string | null
          birth_date?: string | null
          class_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          emergency_contact?: string | null
          emergency_phone?: string | null
          enrollment_year?: number | null
          full_name?: string | null
          gender?: string | null
          id?: string
          id_card?: string | null
          major?: string | null
          phone?: string | null
          photo_url?: string | null
          political_status?: string | null
          school?: string | null
          student_no?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rule_library: {
        Row: {
          active: boolean
          content: string
          created_at: string
          created_by: string | null
          id: string
          rule_no: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          rule_no?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          rule_no?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rule_library_backup_20260424: {
        Row: {
          active: boolean | null
          content: string | null
          created_at: string | null
          created_by: string | null
          id: string | null
          rule_no: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          rule_no?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          content?: string | null
          created_at?: string | null
          created_by?: string | null
          id?: string | null
          rule_no?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      rules: {
        Row: {
          achievement: string | null
          active: boolean
          category: string | null
          created_at: string
          created_by: string | null
          credit: number
          description: string | null
          id: string
          identity: string | null
          keywords: string[]
          level: string | null
          name: string
          project: string | null
          updated_at: string
        }
        Insert: {
          achievement?: string | null
          active?: boolean
          category?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          description?: string | null
          id?: string
          identity?: string | null
          keywords?: string[]
          level?: string | null
          name: string
          project?: string | null
          updated_at?: string
        }
        Update: {
          achievement?: string | null
          active?: boolean
          category?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          description?: string | null
          id?: string
          identity?: string | null
          keywords?: string[]
          level?: string | null
          name?: string
          project?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rules_backup_20260424: {
        Row: {
          achievement: string | null
          active: boolean | null
          category: string | null
          created_at: string | null
          created_by: string | null
          credit: number | null
          description: string | null
          id: string | null
          identity: string | null
          keywords: string[] | null
          level: string | null
          name: string | null
          project: string | null
          updated_at: string | null
        }
        Insert: {
          achievement?: string | null
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          credit?: number | null
          description?: string | null
          id?: string | null
          identity?: string | null
          keywords?: string[] | null
          level?: string | null
          name?: string | null
          project?: string | null
          updated_at?: string | null
        }
        Update: {
          achievement?: string | null
          active?: boolean | null
          category?: string | null
          created_at?: string | null
          created_by?: string | null
          credit?: number | null
          description?: string | null
          id?: string | null
          identity?: string | null
          keywords?: string[] | null
          level?: string | null
          name?: string | null
          project?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      submission_records: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          actor_role: string | null
          ai_confidence: number | null
          ai_decision: string | null
          ai_matched_rule_id: string | null
          ai_reasoning: string | null
          ai_suggested_credit: number | null
          application_id: string
          created_at: string
          description_snapshot: string | null
          event_type: Database["public"]["Enums"]["submission_event_type"]
          file_path: string | null
          id: string
          keywords_snapshot: string[] | null
          matched_rule_id: string | null
          review_credit: number | null
          review_decision: string | null
          review_note: string | null
          status_snapshot: string | null
          student_id: string
          student_name: string | null
          student_no: string | null
        }
        Insert: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          ai_confidence?: number | null
          ai_decision?: string | null
          ai_matched_rule_id?: string | null
          ai_reasoning?: string | null
          ai_suggested_credit?: number | null
          application_id: string
          created_at?: string
          description_snapshot?: string | null
          event_type: Database["public"]["Enums"]["submission_event_type"]
          file_path?: string | null
          id?: string
          keywords_snapshot?: string[] | null
          matched_rule_id?: string | null
          review_credit?: number | null
          review_decision?: string | null
          review_note?: string | null
          status_snapshot?: string | null
          student_id: string
          student_name?: string | null
          student_no?: string | null
        }
        Update: {
          actor_id?: string | null
          actor_name?: string | null
          actor_role?: string | null
          ai_confidence?: number | null
          ai_decision?: string | null
          ai_matched_rule_id?: string | null
          ai_reasoning?: string | null
          ai_suggested_credit?: number | null
          application_id?: string
          created_at?: string
          description_snapshot?: string | null
          event_type?: Database["public"]["Enums"]["submission_event_type"]
          file_path?: string | null
          id?: string
          keywords_snapshot?: string[] | null
          matched_rule_id?: string | null
          review_credit?: number | null
          review_decision?: string | null
          review_note?: string | null
          status_snapshot?: string | null
          student_id?: string
          student_name?: string | null
          student_no?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      submission_summary: {
        Row: {
          ai_confidence: number | null
          ai_matched_rule_id: string | null
          ai_reasoning: string | null
          ai_suggested_credit: number | null
          application_id: string | null
          class_name: string | null
          custom_keywords: string[] | null
          department: string | null
          description: string | null
          file_path: string | null
          final_credit: number | null
          final_review_note: string | null
          final_reviewer_id: string | null
          reviewed_at: string | null
          reviewer_name: string | null
          selected_keywords: string[] | null
          status: string | null
          student_id: string | null
          student_name: string | null
          student_no: string | null
          submitted_at: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "applications_ai_matched_rule_id_fkey"
            columns: ["ai_matched_rule_id"]
            isOneToOne: false
            referencedRelation: "rules"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      ai_decrypt_provider_key: {
        Args: { _provider_id: string; _secret: string }
        Returns: string
      }
      ai_encrypt_api_key: {
        Args: { _plain: string; _secret: string }
        Returns: {
          encrypted: string
          last4: string
        }[]
      }
      dedupe_keywords: {
        Args: never
        Returns: {
          deleted_count: number
          merged_count: number
        }[]
      }
      gen_certificate_no: { Args: { _app_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      normalize_keyword: { Args: { s: string }; Returns: string }
      refresh_certificate_types: { Args: never; Returns: number }
      strip_time_tokens: { Args: { s: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "teacher" | "student"
      application_status:
        | "pending_ai"
        | "auto_approved"
        | "pending_review"
        | "rejected_by_ai"
        | "approved"
        | "rejected"
      review_action: "ai_evaluation" | "teacher_review" | "admin_review"
      submission_event_type:
        | "submitted"
        | "ai_reviewed"
        | "manual_reviewed"
        | "resubmitted"
        | "withdrawn"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "teacher", "student"],
      application_status: [
        "pending_ai",
        "auto_approved",
        "pending_review",
        "rejected_by_ai",
        "approved",
        "rejected",
      ],
      review_action: ["ai_evaluation", "teacher_review", "admin_review"],
      submission_event_type: [
        "submitted",
        "ai_reviewed",
        "manual_reviewed",
        "resubmitted",
        "withdrawn",
      ],
    },
  },
} as const

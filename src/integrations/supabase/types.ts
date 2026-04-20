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
          ai_confidence: number | null
          ai_matched_rule_id: string | null
          ai_reasoning: string | null
          ai_suggested_credit: number | null
          created_at: string
          description: string
          file_path: string | null
          final_credit: number | null
          final_review_note: string | null
          final_reviewer_id: string | null
          id: string
          project_id: string
          reviewed_at: string | null
          selected_keywords: string[]
          status: Database["public"]["Enums"]["application_status"]
          student_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: {
          ai_confidence?: number | null
          ai_matched_rule_id?: string | null
          ai_reasoning?: string | null
          ai_suggested_credit?: number | null
          created_at?: string
          description: string
          file_path?: string | null
          final_credit?: number | null
          final_review_note?: string | null
          final_reviewer_id?: string | null
          id?: string
          project_id: string
          reviewed_at?: string | null
          selected_keywords?: string[]
          status?: Database["public"]["Enums"]["application_status"]
          student_id: string
          submitted_at?: string
          updated_at?: string
        }
        Update: {
          ai_confidence?: number | null
          ai_matched_rule_id?: string | null
          ai_reasoning?: string | null
          ai_suggested_credit?: number | null
          created_at?: string
          description?: string
          file_path?: string | null
          final_credit?: number | null
          final_review_note?: string | null
          final_reviewer_id?: string | null
          id?: string
          project_id?: string
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
          {
            foreignKeyName: "applications_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
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
      profiles: {
        Row: {
          class_name: string | null
          created_at: string
          department: string | null
          email: string | null
          full_name: string | null
          id: string
          major: string | null
          phone: string | null
          student_no: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          class_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          major?: string | null
          phone?: string | null
          student_no?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          class_name?: string | null
          created_at?: string
          department?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          major?: string | null
          phone?: string | null
          student_no?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      project_collaborators: {
        Row: {
          created_at: string
          id: string
          project_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_collaborators_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          active: boolean
          created_at: string
          created_by: string
          description: string | null
          ends_at: string | null
          id: string
          name: string
          rule_ids: string[]
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          created_by: string
          description?: string | null
          ends_at?: string | null
          id?: string
          name: string
          rule_ids?: string[]
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          created_by?: string
          description?: string | null
          ends_at?: string | null
          id?: string
          name?: string
          rule_ids?: string[]
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rules: {
        Row: {
          active: boolean
          category: string | null
          created_at: string
          created_by: string | null
          credit: number
          description: string | null
          id: string
          keywords: string[]
          name: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          category?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          description?: string | null
          id?: string
          keywords?: string[]
          name: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          category?: string | null
          created_at?: string
          created_by?: string | null
          credit?: number
          description?: string | null
          id?: string
          keywords?: string[]
          name?: string
          updated_at?: string
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
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_project_reviewer: {
        Args: { _project_id: string; _user_id: string }
        Returns: boolean
      }
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
    },
  },
} as const

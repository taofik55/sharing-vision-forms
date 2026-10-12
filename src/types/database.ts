export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      dashboard_shares: {
        Row: {
          created_at: string;
          created_by: string | null;
          expires_at: string | null;
          form_id: string;
          id: string;
          include_text_answers: boolean;
          is_active: boolean;
          token: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          form_id: string;
          id?: string;
          include_text_answers?: boolean;
          is_active?: boolean;
          token?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expires_at?: string | null;
          form_id?: string;
          id?: string;
          include_text_answers?: boolean;
          is_active?: boolean;
          token?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dashboard_shares_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dashboard_shares_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
        ];
      };
      dashboards: {
        Row: {
          config: NonNullable<Json>;
          form_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          config?: NonNullable<Json>;
          form_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          config?: NonNullable<Json>;
          form_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dashboards_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: true;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dashboards_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      form_members: {
        Row: {
          created_at: string;
          form_id: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          form_id: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          form_id?: string;
          role?: Database["public"]["Enums"]["member_role"];
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "form_members_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_members_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      form_versions: {
        Row: {
          definition: NonNullable<Json>;
          form_id: string;
          id: string;
          published_at: string;
          published_by: string | null;
          version_number: number;
        };
        ComputedFields: never;
        Insert: {
          definition: NonNullable<Json>;
          form_id: string;
          id?: string;
          published_at?: string;
          published_by?: string | null;
          version_number: number;
        };
        Update: {
          definition?: NonNullable<Json>;
          form_id?: string;
          id?: string;
          published_at?: string;
          published_by?: string | null;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "form_versions_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "form_versions_published_by_fkey";
            columns: ["published_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      forms: {
        Row: {
          closed_message: string | null;
          created_at: string;
          current_version_id: string | null;
          deadline_at: string | null;
          description: string | null;
          draft_definition: NonNullable<Json>;
          id: string;
          identifier_mode: Database["public"]["Enums"]["identifier_mode"];
          is_demo: boolean;
          owner_id: string;
          slug: string;
          status: Database["public"]["Enums"]["form_status"];
          thank_you_message: string | null;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          closed_message?: string | null;
          created_at?: string;
          current_version_id?: string | null;
          deadline_at?: string | null;
          description?: string | null;
          draft_definition?: NonNullable<Json>;
          id?: string;
          identifier_mode?: Database["public"]["Enums"]["identifier_mode"];
          is_demo?: boolean;
          owner_id: string;
          slug: string;
          status?: Database["public"]["Enums"]["form_status"];
          thank_you_message?: string | null;
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          closed_message?: string | null;
          created_at?: string;
          current_version_id?: string | null;
          deadline_at?: string | null;
          description?: string | null;
          draft_definition?: NonNullable<Json>;
          id?: string;
          identifier_mode?: Database["public"]["Enums"]["identifier_mode"];
          is_demo?: boolean;
          owner_id?: string;
          slug?: string;
          status?: Database["public"]["Enums"]["form_status"];
          thank_you_message?: string | null;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "forms_current_version_fk";
            columns: ["current_version_id", "id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id", "form_id"];
          },
          {
            foreignKeyName: "forms_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "forms_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          locale: string;
          role: Database["public"]["Enums"]["app_role"];
          workspace_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          locale?: string;
          role?: Database["public"]["Enums"]["app_role"];
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          locale?: string;
          role?: Database["public"]["Enums"]["app_role"];
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      rate_limits: {
        Row: {
          bucket: string;
          hits: number;
          window_start: string;
        };
        ComputedFields: never;
        Insert: {
          bucket: string;
          hits?: number;
          window_start: string;
        };
        Update: {
          bucket?: string;
          hits?: number;
          window_start?: string;
        };
        Relationships: [];
      };
      response_answers: {
        Row: {
          form_id: string;
          id: number;
          question_key: string;
          question_type: string;
          response_id: string;
          value_date: string | null;
          value_json: Json | null;
          value_number: number | null;
          value_options: string[] | null;
          value_text: string | null;
        };
        ComputedFields: never;
        Insert: {
          form_id: string;
          id?: never;
          question_key: string;
          question_type: string;
          response_id: string;
          value_date?: string | null;
          value_json?: Json | null;
          value_number?: number | null;
          value_options?: string[] | null;
          value_text?: string | null;
        };
        Update: {
          form_id?: string;
          id?: never;
          question_key?: string;
          question_type?: string;
          response_id?: string;
          value_date?: string | null;
          value_json?: Json | null;
          value_number?: number | null;
          value_options?: string[] | null;
          value_text?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "response_answers_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_answers_response_id_fkey";
            columns: ["response_id"];
            isOneToOne: false;
            referencedRelation: "responses";
            referencedColumns: ["id"];
          },
        ];
      };
      response_drafts: {
        Row: {
          data: NonNullable<Json>;
          draft_token: string;
          expires_at: string;
          form_id: string;
          id: string;
          updated_at: string;
          version_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          data?: NonNullable<Json>;
          draft_token?: string;
          expires_at?: string;
          form_id: string;
          id?: string;
          updated_at?: string;
          version_id?: string | null;
        };
        Update: {
          data?: NonNullable<Json>;
          draft_token?: string;
          expires_at?: string;
          form_id?: string;
          id?: string;
          updated_at?: string;
          version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "response_drafts_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "response_drafts_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      responses: {
        Row: {
          device: string | null;
          duration_seconds: number | null;
          form_id: string;
          form_version_id: string;
          id: string;
          identifier_email: string | null;
          identifier_key: string | null;
          identifier_phone: string | null;
          is_demo: boolean;
          locale: string | null;
          submission_token: string | null;
          submitted_at: string;
        };
        ComputedFields: never;
        Insert: {
          device?: string | null;
          duration_seconds?: number | null;
          form_id: string;
          form_version_id: string;
          id?: string;
          identifier_email?: string | null;
          identifier_key?: string | null;
          identifier_phone?: string | null;
          is_demo?: boolean;
          locale?: string | null;
          submission_token?: string | null;
          submitted_at?: string;
        };
        Update: {
          device?: string | null;
          duration_seconds?: number | null;
          form_id?: string;
          form_version_id?: string;
          id?: string;
          identifier_email?: string | null;
          identifier_key?: string | null;
          identifier_phone?: string | null;
          is_demo?: boolean;
          locale?: string | null;
          submission_token?: string | null;
          submitted_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "responses_form_id_fkey";
            columns: ["form_id"];
            isOneToOne: false;
            referencedRelation: "forms";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "responses_form_version_fk";
            columns: ["form_version_id", "form_id"];
            isOneToOne: false;
            referencedRelation: "form_versions";
            referencedColumns: ["id", "form_id"];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_form_member: {
        Args: {
          p_email: string;
          p_form_id: string;
          p_role: Database["public"]["Enums"]["member_role"];
        };
        Returns: {
          app_role: Database["public"]["Enums"]["app_role"];
          email: string;
          full_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        }[];
      };
      can_edit_form: { Args: { p_form_id: string }; Returns: boolean };
      can_view_form: { Args: { p_form_id: string }; Returns: boolean };
      check_rate_limit: {
        Args: { p_bucket: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
      current_app_role: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      current_workspace_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      delete_response_draft: {
        Args: { p_draft_token: string; p_form_id: string };
        Returns: undefined;
      };
      is_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      is_form_owner: { Args: { p_form_id: string }; Returns: boolean };
      is_slug_available: {
        Args: { p_form_id?: string; p_slug: string };
        Returns: boolean;
      };
      list_form_members: {
        Args: { p_form_id: string };
        Returns: {
          app_role: Database["public"]["Enums"]["app_role"];
          email: string;
          full_name: string;
          role: Database["public"]["Enums"]["member_role"];
          user_id: string;
        }[];
      };
      list_form_owners: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          name: string;
        }[];
      };
      list_forms: {
        Args: {
          p_limit?: number;
          p_offset?: number;
          p_owner?: string;
          p_scope?: string;
          p_search?: string;
          p_sort?: string;
          p_status?: Database["public"]["Enums"]["form_status"];
        };
        Returns: {
          access: string;
          can_edit: boolean;
          created_at: string;
          current_version_number: number;
          has_unpublished_changes: boolean;
          id: string;
          last_response_at: string;
          owner_id: string;
          owner_name: string;
          response_count: number;
          slug: string;
          status: Database["public"]["Enums"]["form_status"];
          title: string;
          total_count: number;
          updated_at: string;
        }[];
      };
      publish_form: {
        Args: { p_expected_updated_at?: string; p_form_id: string };
        Returns: {
          updated_at: string;
          version_id: string;
          version_number: number;
        }[];
      };
      save_response_draft: {
        Args: {
          p_data: Json;
          p_draft_token: string;
          p_form_id: string;
          p_version_id: string;
        };
        Returns: boolean;
      };
      submit_response: {
        Args: {
          p_answers: Json;
          p_device?: string;
          p_draft_token?: string;
          p_duration_seconds?: number;
          p_form_id: string;
          p_identifier_email?: string;
          p_identifier_key?: string;
          p_identifier_phone?: string;
          p_locale?: string;
          p_submission_token: string;
          p_version_id: string;
        };
        Returns: {
          replayed: boolean;
          response_id: string;
        }[];
      };
    };
    Enums: {
      app_role: "admin" | "editor" | "viewer";
      form_status: "draft" | "published" | "closed" | "archived";
      identifier_mode: "none" | "email" | "phone" | "email_or_phone";
      member_role: "viewer" | "editor";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "editor", "viewer"],
      form_status: ["draft", "published", "closed", "archived"],
      identifier_mode: ["none", "email", "phone", "email_or_phone"],
      member_role: ["viewer", "editor"],
    },
  },
} as const;

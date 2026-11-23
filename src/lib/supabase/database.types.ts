
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "profiles": {
                  Row: {
                    "bio": string,"created_at": string,"id": string,"interests": (string)[],"major": string,"nickname": string,"preferred_category": Database["public"]['Enums']["project_category"],"skills": (string)[],"university_id": string | null,"updated_at": string,"visibility": Database["public"]['Enums']["content_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "bio": string,"created_at"?: string,"id": string,"interests": (string)[],"major": string,"nickname": string,"preferred_category": Database["public"]['Enums']["project_category"],"skills": (string)[],"university_id"?: string | null,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["content_visibility"]
                  }
                  Update: {
                    "bio"?: string,"created_at"?: string,"id"?: string,"interests"?: (string)[],"major"?: string,"nickname"?: string,"preferred_category"?: Database["public"]['Enums']["project_category"],"skills"?: (string)[],"university_id"?: string | null,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["content_visibility"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "profiles_university_id_fkey"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"project_invitations": {
                  Row: {
                    "accepted_at": string | null,"accepted_by": string | null,"created_at": string,"expires_at": string,"id": string,"inviter_id": string,"project_id": string,"status": string,"token_hash": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"expires_at": string,"id"?: string,"inviter_id": string,"project_id": string,"status"?: string,"token_hash": string
                  }
                  Update: {
                    "accepted_at"?: string | null,"accepted_by"?: string | null,"created_at"?: string,"expires_at"?: string,"id"?: string,"inviter_id"?: string,"project_id"?: string,"status"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_invitations_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"project_members": {
                  Row: {
                    "id": string,"joined_at": string,"membership_role": string,"project_id": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: string,"joined_at"?: string,"membership_role": string,"project_id": string,"user_id": string
                  }
                  Update: {
                    "id"?: string,"joined_at"?: string,"membership_role"?: string,"project_id"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "project_members_project_id_fkey"
      columns: ["project_id"]
isOneToOne: false
      referencedRelation: "projects"
      referencedColumns: ["id"]
    }
                  ]
                },"projects": {
                  Row: {
                    "category": Database["public"]['Enums']["project_category"],"completed_at": string | null,"created_at": string,"description": string,"due_date": string | null,"id": string,"owner_id": string,"start_date": string | null,"status": string,"title": string,"updated_at": string,"visibility": Database["public"]['Enums']["content_visibility"]
                  }
                  ComputedFields: never
                  Insert: {
                    "category": Database["public"]['Enums']["project_category"],"completed_at"?: string | null,"created_at"?: string,"description": string,"due_date"?: string | null,"id"?: string,"owner_id": string,"start_date"?: string | null,"status"?: string,"title": string,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["content_visibility"]
                  }
                  Update: {
                    "category"?: Database["public"]['Enums']["project_category"],"completed_at"?: string | null,"created_at"?: string,"description"?: string,"due_date"?: string | null,"id"?: string,"owner_id"?: string,"start_date"?: string | null,"status"?: string,"title"?: string,"updated_at"?: string,"visibility"?: Database["public"]['Enums']["content_visibility"]
                  }
                  Relationships: [
                    
                  ]
                },"universities": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"name": string,"short_name": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name": string,"short_name": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"name"?: string,"short_name"?: string
                  }
                  Relationships: [
                    
                  ]
                },"university_email_domains": {
                  Row: {
                    "email_domain": string,"id": string,"is_active": boolean,"university_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "email_domain": string,"id"?: string,"is_active"?: boolean,"university_id": string
                  }
                  Update: {
                    "email_domain"?: string,"id"?: string,"is_active"?: boolean,"university_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "university_email_domains_university_id_fkey"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                },"university_verifications": {
                  Row: {
                    "created_at": string,"id": string,"status": string,"university_id": string,"user_id": string,"verification_method": string,"verified_at": string,"verified_email": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"status"?: string,"university_id": string,"user_id": string,"verification_method"?: string,"verified_at"?: string,"verified_email": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"status"?: string,"university_id"?: string,"user_id"?: string,"verification_method"?: string,"verified_at"?: string,"verified_email"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "university_verifications_university_id_fkey"
      columns: ["university_id"]
isOneToOne: false
      referencedRelation: "universities"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_project_invite":
{ Args: { "p_token": string }; Returns: string
                           },
"create_project":
{ Args: { "p_category": Database["public"]['Enums']["project_category"],"p_description": string,"p_due_date"?: string,"p_start_date"?: string,"p_title": string,"p_visibility": Database["public"]['Enums']["content_visibility"] }; Returns: string
                           },
"create_project_invite":
{ Args: { "p_project_id": string }; Returns: {
              "expires_at": string,"invite_id": string,"token": string
            }[]
                           },
"list_project_invites":
{ Args: { "p_project_id": string }; Returns: {
              "created_at": string,"expires_at": string,"id": string,"status": string
            }[]
                           },
"list_project_members":
{ Args: { "p_project_id": string }; Returns: {
              "membership_id": string,"membership_role": string,"nickname": string
            }[]
                           },
"my_university_verification":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"revoke_project_invite":
{ Args: { "p_invite_id": string }; Returns: undefined
                           },
"verify_university_email":
{ Args: Record<PropertyKey, never>; Returns: string
                           }
          }
          Enums: {
            "content_visibility": "private"|"public","project_category": "course"|"competition"|"hackathon"|"startup"|"side_project"|"research"|"creative"|"other"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            "content_visibility": ["private", "public"],"project_category": ["course", "competition", "hackathon", "startup", "side_project", "research", "creative", "other"]
          }
        }
} as const
